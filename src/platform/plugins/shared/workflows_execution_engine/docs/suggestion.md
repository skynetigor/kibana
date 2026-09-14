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
6. Isolation is **siblings**, not the parent. Each branch has its own writes. Parent context from before the fan-out is visible to every branch, including the parent’s step executions (see below). Branch writes do not merge into the parent. Read results through the existing parallel aggregate.

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

## Shared context — children load the parent’s step executions

A branch is not a closed workflow. It must see the parent’s context from before the fan-out: inputs, `variables.*` already set, and **the parent’s step executions**. Templates like `{{steps.enrichment.output}}` in a branch body have to resolve to the parent step that already ran, not to empty / not-found.

That is the share. Isolation is the other direction:

- Every branch can load the parent’s step records (read-only).
- A branch can load its own step records.
- A branch cannot load a sibling’s step records. Same names in two branches do not clobber; `{{steps.x}}` inside a branch is “this branch, else the parent,” never “the other item.”
- After the join, the parent does not inherit child step records. It reads the parallel aggregate.

If we pick child executions, this does not fall out. A child document does not contain the parent’s steps. Each child must be able to **load the parent’s step executions** from the parent document (the parent is parked, so that set is stable). If we pick same-document, the records are already there; the loader filters to parent + this branch, excluding siblings.

Do not copy the whole parent step log into each child. Load from the parent document. Snapshot vs live read is the same thing while the parent is parked; do not invent a second store.

---

## Persistence — parent execution document, fail the run on task death

**Use the parent execution document.** The join lives there: the parallel step’s `state.branches` (and child execution ids if we pick child runs). The UI and on-call already read that document. TM only wakes.

The in-memory queue is this task’s trampoline. It is not a store.

**Do not reconstruct a crash mid-tick.** If the Task Manager task fails (process death, uncaught, persist of the tick failed), fail the workflow. Do not continue from the failed step. Do not rebuild in-flight branch cursors from a half-written join. That is the recovery kit #289957 is made of; we are not taking it.

Two different stops:

| Stop | What happened | What we persist | Next |
| --- | --- | --- | --- |
| Clean yield | A branch hit wait / HITL (or the join is waiting on siblings). The tick finished and flushed. | Join on the parent document: who is terminal, who is parked, where to resume those parked branches. | Wake parent later; re-enter the parallel step; continue. |
| Task failure | Worker died or the tick did not flush. | Nothing we trust past the last clean park. | Fail the workflow. User retries the run. |

A business-step failure inside a branch is not this. That is still a branch result (fail-fast / settled). “Task failed” means the runner died, not `console.log` failed.

Why this is enough: the only resumes we owe are the ones we successfully parked. HITL and `wait` already go through that path today. Mid-tick progress that never reached the parent document is allowed to die with the task. Side effects that already landed stay at-least-once; retrying the workflow can repeat them. Same as the rest of the engine.

What we still have to get right (or TM will “resume” a dead run):

- A later task attempt must not treat `RUNNING` / dirty parallel as a yield. If the parent is not cleanly parked, fail it.
- Child-run fork: a **child** task dying is a failed branch (or fail-fast), not automatically “fail the parent workflow,” unless we say so. A **parent** task dying fails the workflow and must cancel leftover children.

This policy deletes crash-recovery. It does not delete dirty-vs-clean detection, leftover-child cancel, or the product call that a Kibana restart during a hot tick fails the run.

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

## Code sketch — in-task job queue on top of `runWorkflow`

One Task Manager task owns one in-memory queue. Strategies share one interface. The loop sits **above** `runWorkflow`; node implementations stay as they are. A parallel step does not walk a branch. It enqueues a parallel-run and parks.

Wait / HITL / delay steps **stop yielding a Task Manager task themselves.** Today `handle_execution_delay` (and HITL park) decide in the sequential loop: sleep in-process if under 5s, else schedule a resume. That decision moves to the orchestrator. The step only enqueues a job (“this execution is waiting until X” / “this execution is waiting for input”). The job loop looks at the whole queue and decides: sleep in the runner (wait under 5s), schedule a TM task, keep draining other runnable jobs, or persist a clean park and return.

```
Task start
  queue.enqueue(SingleRun { executionId: parent, graph: parentGraph })
  while (job = queue.take()) {
    await job.run()          // may enqueue more jobs
  }
  // queue idle → persist clean park if anything yielded, then return
```

### Queue

A class in this task only. `enqueue` / `take`. Not durable. Survives only until the task returns. After a clean yield, the parent document is the store; the next task starts a new queue and seeds `SingleRun(parent)` again.

The parallel step (and nested parallel inside a branch) must see this queue. It is task context, not a global.

### Job interface

One `run()`. Each strategy is its own class.

| Job | Holds | `run()` |
| --- | --- | --- |
| `SingleRun` | `executionId`, `graph` | Call `runWorkflow` (or the inner sequential loop) for that one execution until it terminals or parks. |
| `ParallelRun` | `executionIds[]`, `graphs[]` (one pair per branch) | Run the admitted branches concurrently (`allSettled`). Each branch is a sequential run of that graph / id. |
| `Wait` (HITL / delay / timer) | `executionId`, why (input vs `resumeAt`) | Does not sleep or schedule. It is a signal. The orchestrator decides. |

`ParallelRun` is the fan-out. It does not implement `if` / `foreach`. It only joins branch outcomes.

- Branch **terminal:** mark that id on the join (parent document).
- **All terminal:** `enqueue(SingleRun { parent })` so the parent continues after the parallel step.
- Branch **yield** (wait / HITL): mark parked on the join. Do **not** enqueue the parent. When every admitted branch in this tick has settled, persist the join and stop. Nested parallel: a branch `SingleRun` that hits `parallel` enqueues another `ParallelRun` on the **same** queue and parks that branch.

### Where today’s code goes

- Seed the queue from the existing task entry (today: `runWorkflow(parent)`).
- `runWorkflow` stays the sequential runner for **one** execution. It does not know about siblings.
- `EnterParallelNodeImpl` drops `advanceBranch`. It writes the join, enqueues `ParallelRun`, parks the current execution, returns.
- Wait / HITL / delay drop direct TM yield. They enqueue a `Wait` job and return. No `ensureScheduled` / `enterWaitUntil` as a side effect of the step.
- The job loop is the only new control layer. It is also the only place that may sleep in the runner or schedule a TM task.

```
class TaskJobQueue {
  enqueue(job: Job): void
  take(): Job | undefined
}

interface Job {
  run(queue: TaskJobQueue): Promise<void>
}

class SingleRunJob implements Job {
  constructor(executionId, graph) {}
  // runWorkflow(executionId) until terminal or park
}

class ParallelRunJob implements Job {
  constructor(executionIds, graphs) {}
  // allSettled of branch sequential runs
  // all terminal → queue.enqueue(SingleRun(parent))
  // else persist join on parent document, do not enqueue parent
}

async function runTask(parentExecutionId, parentGraph) {
  const queue = new TaskJobQueue()
  queue.enqueue(new SingleRunJob(parentExecutionId, parentGraph))
  while (true) {
    const job = queue.take()
    if (!job) break
    await job.run(queue)
  }
}
```

`ParallelRun` may `allSettled` the branches itself, or enqueue N `SingleRun`s. Prefer the former for one-tick overlap; the loop stays simple (one job at a time) and concurrency lives in the parallel-run strategy. Do not do both.

Orchestrator policy when the queue has `Wait` jobs (and possibly more `SingleRun` / `ParallelRun`):

- Another execution is still runnable → drain it. Do not park the task because one branch hit wait.
- Soonest `resumeAt` is under 5s and nothing else is runnable → sleep in the runner, then `enqueue(SingleRun)` for that id.
- Longer timer, HITL, or mixed waits that cannot be covered by an in-runner sleep → persist clean park, **one** TM schedule (or HITL external resume), return.
- Do not let each wait step schedule its own task.

---

## Gaps (open) — this sketch

- **`runWorkflow` is a fat entry.** Today it does setup, queue-drain, the sequential loop, and post-loop (parent resume, metering). Calling it as-is for every branch may re-do setup and post-loop N times. Likely: `SingleRun` calls the **inner** sequential loop; full `runWorkflow` remains the parent task wrapper *or* is split so setup is once per execution id. Not decided.
- **Graph per branch.** Full parent graph + start node, or a branch subgraph? Execution id per branch vs parent id + index (the fork).
- **How the parallel node gets the queue.** Must be passed as task context into the sequential run. No implicit global.
- **Admission.** `concurrency.max` is `ParallelRun`’s problem (which ids run this tick). The queue is not a scheduler across tasks.
- **Re-seed after yield.** Next TM wake: new queue, `SingleRun(parent)` only. Parent re-enters the parallel step, reads the join, enqueues a new `ParallelRun` for branches that are not terminal (or no-ops if still waiting on HITL). Do not replay finished branches.
- **`handle_execution_delay` moves up.** Short-wait (under 5s) vs TM schedule vs HITL park must not remain in the sequential loop, or steps will keep yielding tasks. Gap: one execution’s short wait vs a sibling still running — the orchestrator must prefer draining the sibling over sleeping the whole runner.

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

1b. **Dirty vs clean park.** Task death fails the workflow only if the next TM attempt can tell “not a yield.” Otherwise TM retry continues from a ghost step. Also: cancel leftover branch work after the parent is failed. Product: a restart during a hot parallel tick fails the run — say it.

2. **How a branch is identified.** Same execution id + branch index, or a child execution id? Step records, logs, and the execution tree have to stay readable. Gap: UI / “which step belongs to which branch” if we spawn real children.

3. **Shared parent steps + sibling isolation.** Each child must load the parent’s step executions; siblings must not see each other. Child-run fork: the child runner needs a parent-step loader (parent document, read-only). Same-document: filter the existing step log (parent + this branch). Sequential flattening outside parallel must not change. Still undesigned: loop-source pins, eviction, and `{{steps.x}}` when both parent and this branch have an `x`.

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
3. Parallel step: enqueue `ParallelRun` / join only; stop walking a single successor. Job loop above `runWorkflow`; `SingleRun` is one execution. Wait / HITL enqueue a `Wait` job; the orchestrator schedules TM or sleeps under 5s — steps do not yield tasks.
4. Persist join on the **parent** execution document at clean park only. TM only wakes. Task death fails the workflow; no mid-step continue.
5. Wake parent; idempotent “all terminal?”; single-flight continue.
6. Flag on. Sequential path untouched.
7. Prove parent step visibility, sibling isolation, and sequential-equivalence before anything else.

Do not: unify sequential onto a new cursor engine, delete V1 in the same change, put the join in TM state, poll the join, or let every branch schedule the parent.
