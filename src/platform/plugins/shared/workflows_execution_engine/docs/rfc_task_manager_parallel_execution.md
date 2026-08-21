# RFC: Task Manager — Per-Type Concurrency Cap and Internal Parallelism

**Audience:** Task Manager platform team  
**Requested by:** One Workflow / Response Ops  
**Related:** `rfc_batched_execution_partitions.md` (the workflows-side design this supersedes)

---

## Problem

Task Manager has a single global slot pool (`max_workers`, typically 10–20 per Kibana node). All registered task types compete for slots on a first-come, first-served basis. When one task type produces a large burst — e.g., 1,000 alert-triggered `workflow:run` tasks — it can saturate the pool and starve every other system (Reporting, Alerting, Synthetics, ML) for the duration of those tasks.

Two distinct problems compound each other:

1. **Fairness**: no mechanism prevents a single task type from consuming all slots.
2. **Throughput waste**: `workflow:run` tasks spend ~95% of their wall-clock time `await`-ing network I/O (connector calls, ES queries). The Node event loop is idle almost the entire time each slot is held. Running many such tasks in parallel within a single slot is safe and would multiply effective throughput with no additional slot cost.

Both problems are general — any I/O-heavy task type that can burst (Alerting, Synthetics, ML inference) faces them. Solving at the Task Manager layer benefits all users, rather than requiring each plugin to independently build polling/partitioning infrastructure.

---

## Proposed API Changes

Two optional fields added to `TaskDefinition`:

```typescript
interface TaskDefinition {
  // ... existing fields ...

  /**
   * Maximum number of instances of this task type that may run concurrently
   * across all workers on this Kibana node.
   *
   * When omitted, the task type competes for any available slot (current behaviour).
   * When set, TM will not claim additional instances of this type once this
   * limit is reached, freeing remaining slots for other task types.
   */
  maxConcurrency?: number;

  /**
   * When set, TM claims up to this many pending instances of this task type
   * and runs their task runners concurrently within a single slot via Promise.all.
   *
   * Each runner receives its own `taskInstance` and `fakeRequest` exactly as
   * today — the task runner implementation is unchanged. TM handles per-runner
   * error reporting, retry counting, and state persistence independently.
   *
   * Requires the task type to be safe for concurrent execution (stateless
   * runners, no shared mutable state between instances).
   */
  internalParallelism?: number;
}
```

### Usage example — `workflow:run`

```typescript
plugins.taskManager.registerTaskDefinitions({
  [WORKFLOW_RUN_TASK_TYPE]: {
    title: 'Run Workflow',
    timeout: '365d',
    maxAttempts: 3,
    maxConcurrency: 8,          // at most 8 slots used by workflow:run on this node
    internalParallelism: 20,    // each slot runs up to 20 workflow:run runners in parallel
    createTaskRunner: ({ taskInstance, fakeRequest, signal, setCustomTaskRunEventFields }) => ({
      // unchanged — exactly as it is today
      run: async () => { ... },
      cancel: async () => { ... },
    }),
  },
});
```

With these settings, `workflow:run` occupies at most 8 slots but processes up to 8 × 20 = 160 executions concurrently. A burst of 1,000 tasks drains in roughly the same wall-clock time as 160 tasks today, while leaving `max_workers − 8` slots free for all other task types.

---

## Feature 1: `maxConcurrency`

### Semantics

- Scoped per Kibana node (not cluster-wide). Each node independently enforces its own limit.
- Applies to claimed (running) instances, not to the queue depth.
- When the running count for type T reaches `maxConcurrency`, TM skips claiming new T instances during that poll cycle. Other task types continue to fill available slots normally.

### Implementation sketch

TM already tracks per-type running counts internally (used for metrics). The change is to consult these counts before claiming:

```typescript
// in the claiming loop (pseudocode)
for (const candidate of claimableTasks) {
  const def = taskDefinitions[candidate.type];
  if (def.maxConcurrency !== undefined) {
    const running = runningCountByType.get(candidate.type) ?? 0;
    if (running >= def.maxConcurrency) continue; // skip — type is at its cap
  }
  claim(candidate);
}
```

This is additive — no existing behaviour changes for task types that do not set `maxConcurrency`.

### Fairness model

`maxConcurrency` is a ceiling, not a reservation. It prevents monopoly without guaranteeing a minimum. If a task type with `maxConcurrency: 8` has only 2 instances queued, those 2 run and the remaining 6 slots go to other types. A reservation model (guaranteed minimum slots per type) is out of scope for this RFC.

---

## Feature 2: `internalParallelism`

### Implementation approach — a TM-internal system task

Rather than modifying the main polling loop's claim logic, `internalParallelism` is implemented via a dedicated **TM-internal system task** (e.g., `taskManager:parallel-runner`). This keeps the main polling loop change minimal and the batching logic self-contained inside TM.

**Two-part change:**

**Part A — main polling loop filter (one line change):**

When the main polling loop evaluates candidates to claim, it skips task instances whose type has `internalParallelism > 1`. Those tasks are invisible to the normal claim cycle.

```typescript
// in the claiming loop — the only change to existing code
if ((taskDefinitions[candidate.type]?.internalParallelism ?? 1) > 1) continue;
```

**Part B — the `taskManager:parallel-runner` system task:**

TM registers its own internal task definition at startup. The system task is a long-lived polling loop (like `workflow:run` today with a long timeout) that:

1. Queries `.kibana_task_manager` for task instances of types with `internalParallelism > 1` that are due (`runAt <= now`, `status: idle`).
2. Claims a batch of up to `internalParallelism` instances per type using TM's existing OCC claim mechanism.
3. For each claimed instance: reconstructs the `fakeRequest` from the task's stored API key — using the same internal TM code path that the normal claim loop uses today.
4. Calls `createTaskRunner({ taskInstance, fakeRequest, signal, setCustomTaskRunEventFields })` per instance.
5. Runs all runners via `Promise.all`, each with its own per-runner `AbortController`.
6. Reports results per instance — updates each task document, applies per-instance retry logic and state persistence.
7. Loops immediately if the batch was full; otherwise sleeps briefly before the next poll.

Because this is a TM-internal task, it has full access to TM's private API key and `fakeRequest` construction code. No plugin-level workaround is needed.

TM starts one `taskManager:parallel-runner` instance at plugin setup (or one per logical partition if throughput demands it). Its stable task ID means only one Kibana node runs it at a time — TM's own deduplication handles HA.

### From the task runner's perspective — nothing changes

`createTaskRunner` is called with one `taskInstance` and returns one `{ run, cancel }`. The runner executes normally. The parallelism is entirely inside the `taskManager:parallel-runner` system task, invisible to the registered task type.

### Per-runner independence

Each runner in a batch is independent:

- **Errors**: one runner throwing does not abort others. TM catches the error, applies that instance's retry / exhaustion logic, and continues.
- **Cancellation**: when the system task is cancelled (node shutdown), it broadcasts the abort signal to all in-flight per-runner `AbortController`s.
- **State / result**: each runner's `state` and `shouldDeleteTask` are applied to its own task document.
- **Retry count**: `taskInstance.attempts` is per-instance, unchanged.
- **`setCustomTaskRunEventFields`**: per-instance, emitted independently.

### `maxConcurrency` interaction

`internalParallelism` multiplies throughput within the `maxConcurrency` cap:

```
effective concurrency = maxConcurrency × internalParallelism
slots consumed        = maxConcurrency  (system task slots, fixed)
```

Both features are independent and composable. A task type can use either or both.

---

## What Does Not Change

- `createTaskRunner` signature — unchanged.
- Task runner implementations — zero changes required.
- API key handling — TM creates a `fakeRequest` per task instance exactly as today. Per-runner credential isolation is preserved automatically.
- Retry logic (`maxAttempts`, `resolveInterruptedWorkflowRunTask`, etc.) — per-instance, unchanged.
- Task document schema — no new fields on task documents.
- Metrics and monitoring — per-type running counts already exist; `internalParallelism` adds a new dimension (runners/slot) that should be emitted as a metric.

---

## Beneficiaries Beyond Workflows

Any I/O-heavy, burst-prone, stateless task type benefits from both features:

| Task type | Problem today | With these features |
|---|---|---|
| `workflow:run` | 1k alert burst monopolises all slots | `maxConcurrency: 8, internalParallelism: 20` → 160 concurrent, 8 slots |
| Alerting rule runs | Large rule sets can starve other types | `maxConcurrency: N` caps fairness |
| Synthetics monitors | Similar burst pattern | `internalParallelism` multiplies throughput |
| ML inference tasks | I/O-heavy, bursty | Same pattern |

`maxConcurrency` alone (without `internalParallelism`) is useful to any task type that wants to express a throughput ceiling without touching its runner implementation.

---

## Risks

| Risk | Severity | Note |
|---|---|---|
| System task crash leaves in-flight runners without recovery | Medium | `taskManager:parallel-runner` uses TM's own retry; on restart it re-queries `.kibana_task_manager` for instances still marked `claimed` and resets them (same interrupt recovery TM does for normal tasks) |
| One crashing runner masks others | Low | Each runner's error is caught independently inside `Promise.all`; others continue |
| Claim race between two `taskManager:parallel-runner` nodes | Low | Stable task ID means only one node runs it; OCC on task documents is the correctness backstop |
| Node shutdown with large batch in-flight | Medium | System task `cancel()` broadcasts abort to all per-runner `AbortController`s; existing interrupt recovery (attempts > 1) handles any that don't terminate cleanly |
| `internalParallelism` with stateful runners | Medium | Must be documented: runners sharing mutable state across instances must not set this flag. A guard (e.g., `concurrentRunnersSafe: true` required alongside `internalParallelism`) would make misuse explicit |
| Throughput metrics become misleading (one slot does M runners' work) | Low | Add `parallel_runners_active` gauge to TM metrics; document that `tasks_per_slot` is no longer 1:1 for parallel types |

---

## Non-Goals

- **Cluster-wide `maxConcurrency`**: per-node is sufficient and avoids distributed coordination.
- **Dynamic `internalParallelism` at runtime**: static task definition config only.
- **Priority queues or guaranteed slot minimums per task type**: a separate, larger effort.
- **Changes to task runner implementations**: the entire value of this design is that existing runners are unmodified.

---

## Open Questions

1. Should `taskManager:parallel-runner` be one instance (polls all parallel types together) or one per type? One instance is simpler; per-type allows independent concurrency tuning.
2. Should `internalParallelism` be a hard upper bound or a hint (`min(pending, M)`)? Hint is correct — claim whatever is available up to M.
3. How does the system task's `fakeRequest` (the task runner's own API key) relate to the sub-task `fakeRequest`s it constructs? The system task's own key is irrelevant to sub-tasks; each sub-task's key is reconstructed from its own task document. This should be explicit in the implementation to avoid confusion.
4. What is the right metric name for parallel runner throughput so the TM Kibana dashboard remains interpretable?
