# RFC Gaps: Batched Execution via Partition Workers

Review of `rfc_batched_execution_partitions.md`. Each gap is rated **Blocker**, **High**, **Medium**, or **Low** based on whether it prevents shipping or just needs a decision.

---

## Blockers

### G1 — Is the API key creation surface public to plugins?

Open question #1 in the RFC, but not marked as a blocker — it is one.

The entire ESO API key model rests on `coreStart.security.authc.apiKeys.create(request, ...)` being callable from a plugin. Task Manager uses this internally via `cloneApiKey: true`. Whether it is part of the public `CoreStart` contract that plugins can call is unknown and must be verified before the design is committed. If it is not public, the ESO approach requires a different mechanism (e.g., a Kibana platform API, a security plugin service, or a delegation through the actions plugin).

---

### G2 — No per-execution retry count; `resolveExhaustedWorkflowRunTask` has nothing to count

The RFC states that `taskInstance.attempts` is "replaced by querying the execution document's own retry state." There is no such field on `EsWorkflowExecution` today. `resolveExhaustedWorkflowRunTask` needs a retry counter to know when to give up and mark the execution permanently FAILED instead of allowing another attempt.

Without this, there are two bad outcomes:
- Executions that throw on every attempt are retried forever (infinite loop in the partition poll).
- Or retry is abandoned entirely (one attempt, fail fast) — a regression from today's three-attempt model.

Must decide: does each execution get N execution-level retries? If yes, add an `executionAttempts` field to the execution doc, increment at claim time, and gate `resolveExhaustedWorkflowRunTask` on it.

---

### G3 — Partition task exhausted after `maxAttempts: 3` — all its executions silently stall

The partition task is registered with `maxAttempts: 3`. After three consecutive crashes, TM marks the task exhausted and stops running it. All executions with `partitionIndex == i` remain PENDING indefinitely with no alert, no fallback, no re-scheduling.

This is a silent reliability hole. Options to address:
- Set `maxAttempts` to a very high value or unlimited for partition tasks (they are not user-logic containers, so exhaustion semantics are different).
- Add a watchdog (another TM task or a Kibana health check) that detects stalled partitions and re-schedules them.
- Re-assign stuck executions: a recovery pass that finds PENDING executions older than a threshold and re-assigns their `partitionIndex`.

---

## High

### G4 — ESO creation has no bulk API; 1,000-execution burst means 1,000 sequential saves to `.kibana`

The RFC says ESO creation is "parallelized similarly" to the `_bulk` execution write. There is no bulk ESO create API in Kibana — each `encryptedSavedObjects.create()` is an individual, synchronous-to-ES indexed write to `.kibana`. Parallelizing 1,000 ESO creates hits the `.kibana` index with 1,000 concurrent writes during a burst, which is more damaging than the single `_bulk` write the execution docs already use. The `.kibana` index is not a data stream and can be a bottleneck.

Must address: either accept this cost with a throughput limit at the ingestion boundary (cap `bulkScheduleWorkflow` batch size), or find a way to batch-encrypt and single-bulk-write the key records (would require lower-level access to the encryption primitives than ESO currently exposes).

---

### G5 — Race between `resumeAt` write and `resumeInput` write on external resume

The current external resume path in `internalResumeWorkflowExecution` does two sequential ES writes:
1. `workflowExecutionRepository.updateWorkflowExecution({ context: { resumeInput } })` — writes the user's input.
2. `taskManager.runSoon(idleTimeoutTaskId)` — wakes the task.

With the new model, step 2 becomes `update({ resumeAt: now })`. If the partition worker polls between writes 1 and 2, it sees `resumeAt` not yet set and skips the execution. That is fine. But if the order is reversed — `resumeAt = now` first, then `resumeInput` — the partition worker could start `resumeWorkflow()` before the input is in the document, reading stale context.

Must enforce write order: `resumeInput` must be written before `resumeAt` is set. Document this as an ordering invariant.

---

### G6 — Query A uses a shared size cap of 50 for both PENDING and WAITING_FOR_INPUT

A single `esSearch(size: 50)` combining PENDING and WAITING_FOR_INPUT with a `bool.should` means a backlog of 50+ resumable executions starves newly PENDING ones (all 50 slots go to resumes). The converse is also true under a burst.

Options:
- Two separate queries with independent size caps (e.g., 40 PENDING + 10 WAITING_FOR_INPUT).
- A sort that interleaves by `createdAt` / `resumeAt` to give some natural priority.

---

### G7 — `resumeExecutionUnit` is never defined

The RFC defines `runExecutionUnit` in full but only mentions `resumeExecutionUnit` in the architecture diagram. The `workflow:resume` task runner has its own non-trivial logic: `resolveInterruptedWorkflowResumeTask`, `resumeWorkflow`, idle-timeout re-arm (`return { runAt: idleTimeoutResumeAt }`), and chained-HITL handling. None of this is described for the batch model.

Specifically, after `resumeWorkflow()` completes and the execution hits another `waitForInput` (chained HITL), the current task re-arms itself by returning a future `runAt`. In the batch model, the execution writes `resumeAt = now + newIdleTimeout` and the partition worker picks it up next cycle. This seems correct but must be stated explicitly — it is the load-bearing chained-HITL path.

---

### G8 — Cleanup task mechanism is underspecified; may be O(all terminal executions) per run

The RFC says the cleanup task "queries terminal executions with live ESO entries." There is no efficient way to do this:
- Querying ES for all terminal executions and then checking ESO existence per document is O(terminal executions).
- Querying `.kibana` for all `workflow-execution-api-key` saved objects and cross-referencing is an unbounded scan of the `.kibana` index.

A cleaner approach: add an `apiKeyEsoId` field to the execution document, set it when the ESO is created, cleared (set to null) when the ESO is deleted. The cleanup task then queries: `status IN terminal AND apiKeyEsoId IS NOT NULL`. This turns cleanup into a single targeted ES query with no cross-index join.

---

### G9 — `partitionIndex` on workflow documents — who writes it and when?

The RFC says workflow documents get `partitionIndex = crc32(workflowId) % N` "at creation time." But:
- `@kbn/workflows` (the package that manages workflow documents) does not know about N or partitioning — it is a concern of the execution engine plugin.
- Existing workflows have no `partitionIndex`. A backfill migration is required; the RFC does not describe one.
- Workflows created before the feature flag is enabled have no `partitionIndex`. When the flag is enabled, Query B cannot find them.

Must define: where `partitionIndex` is written for workflows (at workflow save time, from the execution engine plugin's perspective), and how existing workflows are backfilled.

---

### G10 — Orphaned ESO + API key if Kibana crashes after ESO creation but before execution doc write

Scheduling creates three artifacts in order:
1. API key (ES operation)
2. ESO (`.kibana` write)
3. Execution document (data stream write)

A Kibana crash after step 2 but before step 3 leaves an orphaned ESO and API key with no execution document. The cleanup task finds ESOs by cross-referencing execution documents — but this orphan has no execution document, so it is never cleaned up. API keys accumulate.

Must add: a sweep that finds ESOs with no matching execution document (or a TTL-based invalidation on ESOs older than a threshold without a corresponding RUNNING/COMPLETED execution).

---

## Medium

### G11 — Changing N requires a migration of all stored `partitionIndex` values

`partitionIndex` is computed as `crc32(id) % N` and stored at creation time. If N changes (e.g., from 8 to 16 due to load growth), all stored `partitionIndex` values are wrong for the new mapping. Executions with `partitionIndex = 3` under N=8 may map to partition 11 under N=16, but the document still says 3. Partition 11 will never find them; partition 3 still picks them up (if it still runs).

This is manageable as long as N only ever increases and old partitions still run — but it is an implicit constraint that is not stated. If N ever decreases, executions on eliminated partitions are stuck.

Must document N as write-once-per-deployment, changeable only via a full migration that rewrites all `partitionIndex` fields.

---

### G12 — Query B (scheduled workflows) — stale `nextRunAt` backfill behavior is undefined

If a partition was down for 2 hours and a workflow had `nextRunAt` 1 hour ago, the partition claims it and runs it. But should it run once (for the missed tick) or catch up on all missed ticks? The `workflow:scheduled` task today handles this via `checkAndSkipIfExistingScheduledExecution` (skip if a run is already in flight or recently completed). That logic is referenced in the RFC sketch but not explained for the new model. If it runs once and computes `nextRunAt` from the current time, stale ticks are silently dropped, which is the correct behavior for most cases but may not be for all.

---

### G13 — Two execution paths coexist: `executeWorkflowStep` still uses `workflow:run`

`executeWorkflowStep` continues to schedule an individual `workflow:run` task with `cloneApiKey: true`. The `workflow:run` task runner must remain registered. This means two parallel execution paths with different task recovery, retry counting, and APM models coexist indefinitely. The RFC should acknowledge this explicitly and define when (if ever) `executeWorkflowStep` moves to the partition model.

---

### G14 — `resolveInterruptedPartitionTask` recovery at scale

After a partition crash with P=20 in-flight executions, recovery marks 20 executions FAILED. But if the partition crashes repeatedly (e.g., OOM bug triggered by a specific workflow), each recovery pass marks more executions FAILED until the partition exhausts its `maxAttempts`. The RFC does not describe whether repeated recovery runs accumulate: do the `claimedByPartition` executions from prior failed recoveries get re-recovered? (They shouldn't — once FAILED, they are terminal and excluded from the next recovery scan.)

This should be verified: `resolveInterruptedPartitionTask` must only mark executions FAILED if their status is still `RUNNING`. A terminal execution with `claimedByPartition` set is a no-op.

---

### G15 — Partition worker's abort signal is shared across all P in-flight executions

When TM aborts the partition task (node shutdown, cancel), the partition's `AbortController` is aborted. This abort signal is passed to all P in-flight `runWorkflow()` calls. Each workflow's `cancel_workflow_if_requested` loop detects the abort and terminates. But the abort also terminates any `await` inside the partition loop itself — the poll loop, the OCC update, the ESO fetch. The RFC does not describe the graceful shutdown sequence: should claimed-but-not-yet-started executions be released back to PENDING before aborting?

---

### G16 — `workflow:apikey-cleanup` needs a privilege to invalidate API keys

The cleanup task runs with TM's system `fakeRequest`. Invalidating arbitrary API keys via `authc.apiKeys.invalidate()` requires the `manage_api_key` or `manage_own_api_key` privilege. The TM system account may have this; it may not. Must confirm the privilege model for the cleanup task's invalidation calls.

---

## Low

### G17 — APM transaction model regression is understated

The RFC notes APM becomes "coarser at the task level." In practice this means: today, every workflow execution is its own APM transaction with its own trace ID, duration, and error classification. After the change, N×P concurrent executions share one transaction. Distributed tracing (linking an alert → workflow execution → connector calls) breaks. Products that use APM to route on-call pages for failed workflows (if any) would be affected.

Worth a dedicated observability section: what is the new APM instrumentation model? (Per-execution spans as children of the partition transaction, with `workflow_execution_id` labels for correlation.)

---

### G18 — No description of how to handle a PENDING execution that was never picked up due to `partitionIndex` mismatch after N change

If N changes mid-flight and a PENDING execution has `partitionIndex = 9` but partitions only go to 7, it is never picked up. There is no error, no alert, no timeout. It sits PENDING until manual intervention. This is the same as G11 at the individual execution level — but it deserves explicit mention because it affects executions in flight during a deployment, not just historic ones.

---

### G19 — Scheduled workflow `nextRunAt` write conflicts with normal workflow saves

The partition worker writes `nextRunAt` to the workflow document after each scheduled run. The workflow document is also written by the user (updating the definition, enabling/disabling, changing triggers). These writes can conflict — the partition worker's `nextRunAt` update may be rejected (409) if the user saved the document between the run completing and the `nextRunAt` write. The RFC mentions OCC retry but does not specify whether the partition worker re-reads and merges or simply retries the `nextRunAt` write with the new seq_no.

---

### G20 — No observability on partition worker health

There is no described metric, log line, or health check that indicates a partition worker is running, its poll cycle duration, how many executions it processed per cycle, or whether it is stuck. Without this, operational debugging of "why are executions not running?" is difficult. At minimum, the partition loop should emit a structured log per cycle with: partition ID, executions claimed, resumes claimed, scheduled workflows triggered, poll duration, and next sleep interval.

---

## Summary Table

| ID | Area | Severity |
|---|---|---|
| G1 | API key creation surface — public to plugins? | Blocker |
| G2 | No per-execution retry counter | Blocker |
| G3 | Partition task exhaustion silently stalls all its executions | Blocker |
| G4 | No bulk ESO create; 1k burst = 1k individual `.kibana` writes | High |
| G5 | Race between `resumeInput` write and `resumeAt` write | High |
| G6 | Shared size cap in Query A starves PENDING vs WAITING_FOR_INPUT | High |
| G7 | `resumeExecutionUnit` undefined; chained HITL path not described | High |
| G8 | Cleanup query mechanism is O(terminal executions) without `apiKeyEsoId` | High |
| G9 | `partitionIndex` on workflow docs — who writes it; no backfill | High |
| G10 | Orphaned ESO if crash between ESO create and execution doc write | High |
| G11 | Changing N requires migration of all stored `partitionIndex` values | Medium |
| G12 | Stale `nextRunAt` backfill behavior (missed ticks) undefined | Medium |
| G13 | Two coexisting execution paths (`executeWorkflowStep` + partition) | Medium |
| G14 | `resolveInterruptedPartitionTask` repeated-crash accumulation | Medium |
| G15 | Abort signal shared across P executions — graceful shutdown not described | Medium |
| G16 | Cleanup task privilege to invalidate API keys | Medium |
| G17 | APM transaction model regression understated | Low |
| G18 | PENDING execution stuck if `partitionIndex` out of range after N change | Low |
| G19 | `nextRunAt` write conflict with concurrent workflow saves | Low |
| G20 | No partition worker health observability | Low |
