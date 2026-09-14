# Parallel branches as sequential runs (join above the engine)

Sketch for [elastic/security-team#18208](https://github.com/elastic/security-team/issues/18208). Not a spec.

**Call:** do not take [kibana#289957](https://github.com/elastic/kibana/pull/289957) as the vehicle. Keep one sequential engine. Make `parallel` a join over sequential branch runs.

---

## Purpose

A parallel branch must run a real pipeline (`if` / `foreach` / `while` / retry), with `variables.*` isolated from siblings. Sequential `variables.*` stay unchanged. HITL inside a branch can wait.

That is it. Nested parallel (parallel inside a branch) should fall out of the same join. It is not a reason to replace the engine.

---

## Why not #289957

The issue is three pieces: allow flow-control in the branch body, give each branch its own cursor, isolate variables. Sequential already has a cursor and `runNode`. Parallel already has `advanceBranch` — it walks one successor and refuses everything else.

#289957 ships a second product: one cursor engine for **all** new workflows, delete the V1 path and the flag, nested parallel, a whole-workflow termination protocol, fence / budget / fatal-infra / cancel-grace, fail in-flight legacy executions, and infra failures that now kill sequential workflows.

That is the right long-term *destination* (one history model). It is the wrong first PR. File count (~82) is a symptom. The fragility is sequential now sharing the new path, no flag, and a state space of fan-out × retry × terminate × cancel × resume.

Unifying engines is a follow-up after branches can run real logic. It is not a prerequisite. A branch can reuse the existing sequential loop without becoming the root driver for every workflow.

---

## The idea

Put concurrency **above** the node engine, not inside it.

1. The parallel step enqueues a parallel-run (N branch executions) and parks the parent.
2. Each branch is a sequential run of the existing node loop (`if` / `foreach` / retry just work).
3. This tick runs admitted branches with `Promise.all` / `allSettled` until each is **terminal or yield** (wait / HITL). Do not hold a promise until a human answers.
4. If every branch is terminal, the parent is runnable again and continues after the parallel step.
5. If any branch yielded, persist the join and stop. A later wake re-enters the parallel step.
6. Variable isolation falls out if the branch run has its own context. Parent variables are a snapshot at fan-out; branch writes do not merge into the parent. Read results through the existing parallel aggregate.

Industry mapping: Step Functions Parallel/Map, Temporal `Promise.all` of children. One sequential runner. A coordinator parks the parent and joins children.

This engine already has both halves, unconnected: parallel already `Promise.all`s branches in one task and parks the parent; `workflow.execute` already parks a parent as waiting-for-child and resumes it when the child finishes (`resumeSyncParentIfNeeded`). What is missing is: **a branch is itself a sequential run**, not a straight-line walk on the shared cursor.

---

## What already exists (reuse)

- Parallel tick: admit a concurrency window, `Promise.all` branches, persist `state.branches`, park parent if anything is still in flight, reclaim the cursor onto the parallel enter node.
- Child workflow: parent enters wait, child is a sequential execution, child terminal notifies parent, parent step checks the child and either continues or stays waiting (callback, not poll).
- Sequential loop + cursor: already the runner we want per branch.
- Graph: `buildParallelBranchBody` still rejects nested flow-control. That allow-list is a small, required change.

Do not invent a second scheduler if the child-resume path can carry the join.

---

## Persistence — Task Manager state is the wrong store

The in-memory queue is only a trampoline for **this** task. A crash mid-fan-out must reconstruct “these branches, these cursors, this join.”

**Source of truth:** the execution document / parallel-step record (`state.branches` already exists). If a branch is a real child execution, that child’s execution record *is* its cursor; the parent step only needs child ids and “I am waiting.”

**Not Task Manager task state.** TM is the wake. This engine already made that split: the run task’s `state` is `lastRunAt` / last status / last error. Cursors and scopes live on the execution document.

TM state is durable, so it would survive a crash. It is still a bad home for the join:

- N cursors, scopes, and variables do not belong in a task payload.
- On-call and the execution UI read the execution document. A join that only exists on the task is invisible.
- A recreated or orphaned task loses the join.
- A second copy in TM state is two sources of truth.

TM decides *when* to wake. The execution / step record is *what* to resume.

---

## Resume and join

**Do not let each waiting branch `ensureScheduled` the parent as its own scheduler.** That is the concurrent-parent-resume bug (see also kibana#290913).

The right join is the one we already use for `workflow.execute`:

- Something finishes or yields → wake the **parent** task (one identity).
- Parent resumes on the parallel step.
- Step reads the join. If not all branches are terminal, exit (stay parked).
- If all terminal, continue the parent after the step.

That idempotent check handles an *early* wake (one branch done, others not). It does **not** handle two last branches finishing together: both wake the parent, both see “all terminal,” both try to leave the step.

Need both:

1. Cheap no-op if the join is incomplete.
2. Exactly one continue when it completes (OCC on the execution document, or single-flight on the parent task).

**Do not poll.** A timer that asks “are we done yet?” adds load and still needs the same check. Child workflows already moved off poll onto a callback. “First terminal branch starts polling” is the option to drop.

A branch may yield a resume. That resume should not mint a new identity per yield.

- Lightweight branches: one parent task. Yield writes the join, schedules that parent.
- Real child executions: the child has its own task for *its* wait/HITL. On terminal (or when the parent must see something), it notifies the parent once. Same as `resumeSyncParentIfNeeded`.

Yielding work is fine. A herd of parent tasks is not.

---

## Same-task drain vs “exit then check the queue”

The job loop **is** the task if we stay in-process: a parent run that parks is one job finishing; the task returns to TM only when the queue is idle and remaining work is a durable wait. Nested parallel (a branch hits `parallel`) is awkward if drain is a second phase bolted onto today’s loop.

That is addressable **by not inventing that queue** if we pick child runs:

- Parent parks.
- Children are sequential executions.
- Nested parallel is the same move again: that branch parks and starts its own children.

The trampoline (same task drains branches) is only an optimization: avoid a TM hop when nothing waits. It is not the architecture. Do not mix it with “each branch yields a new parent task” and “put the join in TM state.” That is three designs stacked.

---

## The fork (pick one)

### 1. Child runs (reuse `workflow.execute` shape)

Branch = sequential execution. Parent = wait-for-children. Notify + idempotent join + single-flight. Nested case is free. Node implementations stay as they are.

Cost: N execution records, or lightweight records that still behave like children. Product risk: this starts to look like the “hidden child workflow” the issue was trying to stop *users* from writing. Engine-internal children are still the right shape; they must not become a user-facing workaround.

### 2. Same document, one parent task

Join stays on `state.branches`. Same-task `allSettled` for a tick. One wake. No TM-state join, no per-yield parent tasks. `advanceBranch` calls the existing sequential loop instead of walking one edge.

Cost: must persist per-branch cursor + variables on the parent document. Nested parallel needs the in-process job loop to be real (or a branch that hits `parallel` parks and is the join, same as today, recursively).

Either is smaller than unifying cursors. Mixing them is how the sketch gets messy.

**Lean:** (1) if we want the smallest change to node/loop code and HITL-in-branch for free. (2) if we refuse extra execution records in the UI.

---

## What this does not erase

These stay. They live on the coordinator / parallel step, not in `runNode`:

- Join, fail-fast vs settled, `concurrency.max`, skip never-started branches
- Cancel siblings when the parent or a fail-fast branch dies
- `workflow.output` / `workflow.fail` from a branch (terminate the whole workflow: coordinator sees the signal, cancels siblings, completes the parent)
- Graph still rejects HITL only if we choose to; the model can support it
- At-least-once connector delivery (unchanged)

Complexity is real. It is in the right layer.

---

## Gaps (open)

These are not nits. They are the holes in the sketch.

1. **Fork not picked.** Child executions vs same-document lightweight branches. Everything below depends on this.

2. **How a branch is identified.** Same execution id + branch index, or a child execution id? Step records, logs, and the execution tree have to stay readable. Gap: UI / “which step belongs to which branch” if we spawn real children.

3. **Variable isolation is not free until the fork is picked.** Child execution: snapshot parent vars as inputs; child writes stay on the child; aggregate is the only merge. Same-document: `step_io_service` (or equivalent) must be scope-aware *inside* the fan-out and must not change sequential flattening. This is still the delicate piece from the issue. No design yet for loop-source pins, `{{steps.x}}` resolving to “this branch, not a sibling,” or eviction.

4. **Admission vs in-flight vs yielded.** `concurrency.max` today frees a slot when a branch is waiting (`count-waiting: false`). If a yielded branch holds a sequential engine identity, do we keep the slot or rotate? Same-task drain and child-TM-tasks answer this differently. Not designed.

5. **Single-flight parent is assumed, not specified.** OCC on which document, which field, what happens to the losing resume (no-op vs retry)? Existing parent-resume races (#290913) are the same class. Gap: we cannot claim “just check the join” and stop.

6. **Same-task `Promise.all` vs child TM tasks for the first tick.** If branches are child executions, today’s plugin rule is: child executions must **not** run inline in the parent task (cancel/timeout on the parent cannot take effect). That fights the “enqueue in memory and drain in this task” sketch. Either we violate that rule for lightweight branches, or the first tick *is* N TM tasks and the trampoline goes away. Unresolved tension.

7. **Nested parallel.** Falls out of (1). For (2), the job loop must be re-entrant (branch parks, enqueue inner join, drain). Not sketched beyond “addressable.”

8. **`workflow.output` / `fail` from a branch.** Coordinator must persist the first decision, cancel siblings, complete the parent. Losing that race is a correctness bug. #289957 spent a lot of surface here; we still need *a* answer, just not inside `runNode`. Gap: no join protocol written.

9. **Cancellation and timeout.** Parent cancel / parallel overall timeout / branch-timeout: who aborts in-flight branch runtimes, how parked waits are marked, how `workflow.execute` inside a branch is cancelled. Today this lives in `EnterParallelNodeImpl.onCancel`. Must stay on the join, not leak into the sequential loop. HITL-in-branch makes this worse (do not leave a human wait up after the join is dead).

10. **Retry / fallback / `continue` on the parallel step itself.** Retrying the join is new attempt scopes for every branch (or new children). Fallback vs fail-fast interaction. Issue said this may be a fast follow. Say so explicitly if we defer it.

11. **In-flight and rollout.** Issue asked for a flag. #289957 removes the last one. This sketch should keep a flag. Gap: what happens to executions that started under straight-line `advanceBranch` if we change the walker. Prefer: new executions only, or fail explicit, no silent migrate.

12. **Foreach item identity vs static branches.** Dynamic `foreach`-style parallel and named static branches already exist. Branch start node, stack frames, and unique step-execution ids must remain distinct per index. Sketch does not say how the sequential runner is pointed at “this branch’s subgraph.”

13. **Budgets / worker hold.** A flow-control branch is heavier than an atomic one. Ceilings stay (`maxFanOut`, `maxConcurrency`). No new workflow-wide operation budget in this sketch (that was #289957). Confirm we are fine with today’s limits.

14. **Exactly-once / write fence.** Out of scope. External effects stay at-least-once. Do not import #289957’s fence kit to get this issue done.

15. **Tests that actually matter.** Sequential suites should not move. Need: branch `if`/`foreach`/`retry`, sibling variable isolation, sequential-equivalence (non-parallel unchanged), fail-fast + yielded sibling, resume after one branch wait, two last branches completing together (single continue), parent cancel of parked branches. Gap: no list owned yet for child-execution UI / cleanup if we pick (1).

---

## Suggested increment (if we start)

Not a plan until the fork is picked. The smallest honest slice:

1. Pick (1) or (2).
2. Graph: allow `if` / `switch` / `foreach` / `while` / `on-failure` in a branch body; keep HITL rejected until the join can park a branch (or allow it if we pick child runs and accept it).
3. Parallel step: enqueue / join only; stop walking a single successor.
4. Persist join on the execution / step record. TM only wakes.
5. Wake parent; idempotent “all terminal?”; single-flight continue.
6. Flag on. Sequential path untouched.
7. Prove variable isolation and sequential-equivalence before anything else.

Do not: unify sequential onto a new cursor engine, delete V1 in the same change, put the join in TM state, poll the join, or let every branch schedule the parent.
