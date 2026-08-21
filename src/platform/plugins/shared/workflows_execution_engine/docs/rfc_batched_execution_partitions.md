# RFC: Batched Execution via Partition Workers

## Problem

Today every workflow execution creates one `workflow:run` Task Manager task. When 1,000 alerts fire simultaneously, 1,000 tasks are scheduled. Task Manager has a bounded number of slots (e.g., 10 per Kibana node). The burst consumes those slots for the entire duration of the workflows, starving every other system that shares TM (Reporting, Alerting, Synthetics, etc.). This is an unfairness and reliability problem, not a throughput one — the executions do eventually run, but they block everything else.

Because 95 %+ of workflow steps are network I/O (`await connector.execute()`, `await esClient.search()`), the Node event loop is idle for most of each execution. Running many executions in parallel inside a single task via `Promise.all` would let one TM slot do the work that currently takes dozens.

## Proposed Solution

Register a fixed number of **partition worker tasks** (`workflow:batch:0` … `workflow:batch:N-1`) at plugin setup. Each partition task runs as a long-lived TM task and internally loops over two poll queries per cycle:

**Query A — execution work:**
- PENDING executions (new runs to start).
- WAITING_FOR_INPUT executions whose `resumeAt <= now` (idle-timeout expirations and external resumes).

**Query B — scheduled workflow work:**
- Workflow documents whose `nextRunAt <= now` (replaces `workflow:scheduled` TM tasks).

Per claimed item: fetch its API key from the ESO store, construct a per-execution `fakeRequest`, run the appropriate function (`runWorkflow` or `resumeWorkflow`).

Total TM slot consumption: **N** (fixed) regardless of execution or workflow volume. N=8 is a reasonable starting point.

All trigger types — manual, alert, event, scheduled, HITL resume — go through the same path. This replaces all three current TM task types (`workflow:run`, `workflow:resume`, `workflow:scheduled`).

## What Makes It Viable

### The execution model is already stateless

Each `runWorkflow()` call reconstructs all runtime state from ES on entry. There is no cross-execution shared in-memory state. Running ten `runWorkflow()` calls in parallel inside one task is safe today.

### In-flight cancellation already works without TM

`cancelRequested` is polled by `cancel_workflow_if_requested.ts` inside the execution loop every 500 ms. A partition task running ten workflows in parallel can cancel any one of them through this flag without touching TM. TM-level task cancellation is only needed for pre-start executions, handled by a status check before claiming (see below).

### HITL executions suspend cleanly

When a workflow hits `waitForInput`, `runWorkflow()` returns normally. The partition loop treats the suspended execution as done for this cycle. The existing `workflow:resume` task path is untouched — resume still schedules a dedicated one-shot TM task per execution.

## New Fields Required

### `resumeAt` on execution document

Added to `EsWorkflowExecution`. Drives both HITL idle-timeout and immediate external resume without any TM task involvement.

| Scenario | Write |
|---|---|
| Entering `waitForInput` / `waitForApproval` | `resumeAt = now + idleTimeout` |
| External resume (user submits input via API) | `resumeAt = now` (or a past timestamp) |
| Execution completes / is cancelled | `resumeAt = null` |

The partition worker poll query for Query A:
```json
{ "bool": { "should": [
  { "term": { "status": "pending" } },
  { "bool": { "must": [
    { "term": { "status": "waiting_for_input" } },
    { "range": { "resumeAt": { "lte": "now" } } }
  ]}}
]}}
```

This eliminates the stable idle-timeout `workflow:resume` TM task (`getWorkflowGlobalTimeoutResumeTaskId`) and the `taskManager.runSoon()` call from the external resume path. The external resume API now just writes `resumeAt = now` to the execution document — the partition worker picks it up within the next poll cycle (≤ 500 ms).

### `nextRunAt` on workflow document

Added to the workflow document in the `@kbn/workflows` package. Set by the partition worker after each scheduled execution completes, computed from the workflow's cron/RRule definition.

| Scenario | Write |
|---|---|
| Workflow saved with a scheduled trigger | `nextRunAt = first occurrence after now` |
| Scheduled trigger removed or workflow disabled | `nextRunAt = null` |
| After each scheduled run completes | `nextRunAt = next occurrence after now` |
| Atomic claim by partition worker | OCC update: set `nextRunAt = null` before running |

Workflow documents also get a `partitionIndex` field (`crc32(workflowId) % N`) written at creation time, so Query B stays partitioned across workers.

This eliminates the `workflow:scheduled` TM task (one per workflow). All schedule state lives in the workflow document itself.

## Hard Constraints and How to Resolve Them

### 1. Per-execution API key identity (the key challenge)

**Constraint:** `runWorkflow()` requires a `fakeRequest` with the scheduling user's identity. The partition task's own `fakeRequest` belongs to the system account that scheduled it at plugin start — not to the user or service that triggered each individual execution.

**Resolution: per-execution API key stored in an Encrypted Saved Object.**

At scheduling time, when we have the user's (or service's) `KibanaRequest`:

1. Call `coreStart.security.authc.apiKeys.create(request, { name: 'workflow-exec-<id>', ... })` to create a user-scoped API key (same mechanism TM uses internally for `cloneApiKey: true`).
2. Write an Encrypted Saved Object with `id = executionId` and the raw API key as an encrypted attribute. The ESO plugin handles field-level encryption at rest using Kibana's existing keystore.
3. When the partition worker claims the execution, it fetches the ESO by `executionId`, decrypts the key, and constructs a minimal `fakeRequest` with `Authorization: ApiKey <base64(id:key)>` — the same shape TM produces for its task runners.
4. That per-execution `fakeRequest` is passed to `runWorkflow()`.

**What the `fakeRequest` is used for:**
- `coreStart.elasticsearch.client.asScoped(fakeRequest)` — scoped ES client
- `plugins.actions.getActionsClientWithRequest(fakeRequest)` — scoped connector client
- `callKibanaApi` — HTTP calls with the user's auth header
- `coreStart.security.authc.getCurrentUser(fakeRequest)` — identity for logging

All of these ultimately extract the `Authorization` header. A fake request constructed from the stored API key is functionally identical to the original user request for all these purposes.

**API key lifecycle — cleanup task:**

A dedicated scheduled task (`workflow:apikey-cleanup`, running every few minutes) queries terminal executions (status ∈ {COMPLETED, FAILED, CANCELLED, SKIPPED}) that still have a live ESO entry. For each:
1. Calls `coreStart.security.authc.apiKeys.invalidate(keyId)`.
2. Deletes the ESO.

This means API keys live slightly longer than the execution (by at most one cleanup interval). The key is internal — never exposed to users — so this window is low risk. The cleanup can also be triggered eagerly in `handlePostExecutionLoop` for the common case.

**Operational concern — ES API key quota:**

ES defaults to 25,000 active API keys per cluster (configurable via `xpack.security.authc.api_key.max_keys`). At 1,000 burst executions with a 2-minute cleanup cycle, peak live keys ≈ 1,000–2,000. This fits comfortably within the default limit.

**Operational concern — saved object write volume:**

Each execution writes one ESO at scheduling time. `bulkScheduleWorkflow` already writes execution docs in a single `_bulk` call; ESO creation would be parallelized similarly. The `.kibana` index is not a data stream and has more write overhead than the execution data stream. This is the main cost of this approach — acceptable at expected volumes but worth monitoring.

### 2. Atomic claim (prevent double execution)

**Constraint:** Multiple Kibana nodes each run all N partitions. A partition on node A and node B polling simultaneously could both see the same PENDING execution.

**Resolution:** TM's stable-task-ID deduplication ensures only one Kibana node runs each partition at a time — so contention is the exception, not the rule. As a correctness backstop, use ES optimistic concurrency on the claim update:

```
POST .workflows-executions-*/_update/<id>?if_seq_no=<seq>&if_primary_term=<primary>
{
  "script": {
    "source": "if (ctx._source.status == 'pending') {
                 ctx._source.status = 'running';
                 ctx._source.claimedByPartition = params.p;
               } else { ctx.op = 'noop'; }",
    "params": { "p": "workflow:batch:3" }
  }
}
```

A 409 or `noop` result means another partition already claimed it — skip and move on.

### 3. Interrupt recovery after a partition task crash

**Current mechanism:** On TM task retry (attempt > 1), `resolveInterruptedWorkflowRunTask` detects executions left `running` by the previous attempt and marks them `FAILED`.

**New mechanism:** A partition task can have P executions in-flight when it crashes. On retry, the recovery step must:

1. Query ES for all executions with `status: running AND claimedByPartition: <this-partition-id>`.
2. Mark each one `FAILED` with a `TaskRecoveryError`.
3. Trigger eager API key cleanup for each recovered execution.
4. Only then start the normal poll-and-claim loop.

A dedicated `resolveInterruptedPartitionTask(partitionId)` handles this, analogous to the existing `resolveInterruptedWorkflowRunTask`.

### 4. Pre-start cancellation

With batching, there is no individual `workflow:run` TM task to remove for a PENDING execution.

**Resolution:** Write `cancelRequested: true` directly to the execution document. The partition worker checks before claiming — cancelled executions are skipped and their API keys are cleaned up immediately. Simpler than the current TM task removal path.

### 5. Concurrency group enforcement

The concurrency check runs at scheduling time, before the execution becomes PENDING. The partition worker only sees PENDING executions and can assume concurrency was already resolved — no changes to `ConcurrencyManager`.

### 6. Memory pressure within a partition

Each in-flight `runWorkflow()` call holds the compiled DAG, step metadata, `StepIoService` buffers, and the event logger buffer. With P executions in parallel per partition and N partitions, peak memory is O(P × N × per-execution footprint). The `eviction.minPayloadSize` (default 10 KB) already caps individual step output memory. P should be configurable (suggested default: 20).

### 7. ES polling overhead

TM deduplication means N partitions total, not N × Kibana nodes. At N=8, polling every 500 ms: 16 queries/sec baseline. Backoff to up to 5 s when the poll returns empty reduces idle load further.

### 8. APM / telemetry

Currently one TM transaction = one workflow execution. With batching, multiple executions share one TM transaction. Individual workflow traces nest as APM spans. The `workflow_execution_id` label keeps per-execution correlation. APM visibility is coarser at the task level but intact at the workflow level.

## Architecture Sketch

### New execution flow (all trigger types)

```
User or alert triggers execution
  → scheduleWorkflow / bulkScheduleWorkflow / executeWorkflow
      → concurrency check
      → security.authc.apiKeys.create(request, ...)
      → ESO.create({ id: executionId, apiKey: <encrypted> })
      → createWorkflowExecution (status: PENDING, partitionIndex: hash(executionId) % N)
      → [NO workflow:run task scheduled]

User submits HITL input via API
  → workflowExecutionRepository.update({ resumeAt: now })
      → [NO taskManager.runSoon() call]

Workflow with scheduled trigger saved / enabled
  → workflowRepository.update({ nextRunAt: <first occurrence>, partitionIndex: hash(workflowId) % N })
      → [NO workflow:scheduled task scheduled]

─────────────────────────────────────────────────────────────

workflow:batch:3 (partition task, long-running)
  loop:
    ── Query A: execution work ──────────────────────────────
    → esSearch(index: .workflows-executions-*,
               query: { partitionIndex: 3,
                        status: PENDING
                        OR (status: WAITING_FOR_INPUT AND resumeAt <= now) },
               size: 50)
    → for each hit:
        OCC update → RUNNING, claimedByPartition (skip 409/noop)
        ESO.get(executionId) → decrypt → construct fakeRequest
    → Promise.all(
        pending.map(e  → runExecutionUnit(e)),     // runWorkflow path
        resuming.map(e → resumeExecutionUnit(e)),  // resumeWorkflow path
        { concurrency: P }
      )

    ── Query B: scheduled workflow work ─────────────────────
    → esSearch(index: .workflows-*,
               query: { partitionIndex: 3,
                        nextRunAt: { lte: now },
                        enabled: true },
               size: 10)
    → for each hit:
        OCC update: nextRunAt = null (skip 409/noop)
        checkAndSkipIfExistingScheduledExecution(...)
        createWorkflowExecution(status: PENDING, ...)
        → runs inline via runExecutionUnit (same partition, no new task)
        → compute next occurrence from cron/RRule
        → workflowRepository.update({ nextRunAt: <next> })

    → sleep(pollInterval) or immediate if either query returned a full batch

─────────────────────────────────────────────────────────────

workflow:apikey-cleanup (scheduled task, every 2 min)
  → query terminal executions with live ESO entries
  → invalidate API key + delete ESO for each
```

### `runExecutionUnit` — the per-execution function

The body of `runExecutionUnit` is exactly the current `workflow:run` task runner's `run()` function, lifted out of the TM task wrapper:

```typescript
async function runExecutionUnit({ workflowRunId, spaceId, fakeRequest, signal }) {
  // same as workflow:run task runner today:
  const interruptedOutcome = await resolveInterruptedWorkflowRunTask({ workflowRunId, ... });
  if (interruptedOutcome.action === 'task_complete') {
    await handlePostExecutionLoop({ workflowRunId, fakeRequest, ... });
    return;
  }
  try {
    await runWorkflow({ workflowRunId, spaceId, signal, fakeRequest, ... });
  } catch (error) {
    await resolveExhaustedWorkflowRunTask({ workflowRunId, ... });
    throw error;
  }
  await handlePostExecutionLoop({ workflowRunId, fakeRequest, ... });
}
```

The only differences from the current task runner:
- `signal` comes from the partition task's `AbortController`, not a per-execution TM signal.
- `setCustomTaskRunEventFields` is gone — TM event fields are not emitted per execution; partition-level APM spans carry the observability instead.
- `taskInstance.attempts` is replaced by querying the execution document's own retry state for `resolveInterruptedWorkflowRunTask` / `resolveExhaustedWorkflowRunTask`.

The interrupt recovery logic (`resolveInterruptedPartitionTask`) on partition task retry calls `resolveInterruptedWorkflowRunTask` for each execution that was `claimedByPartition` and left in `RUNNING` state — exactly what TM retry does today for individual tasks, just fanned out across the batch.

### Task registration at plugin setup

```typescript
for (let i = 0; i < config.batchPartitions; i++) {
  plugins.taskManager.registerTaskDefinitions({
    [`workflow:batch:${i}`]: {
      title: `Workflow Batch Executor (partition ${i})`,
      timeout: '365d',
      maxAttempts: 3,
      createTaskRunner: ({ signal }) => ({
        run: async () => {
          await resolveInterruptedPartitionTask(i, workflowExecutionRepository, esoClient);
          await runPartitionLoop({ partitionId: i, N, signal, concurrencyLimit: P, esoClient });
        },
        cancel: async () => { abortController.abort(); },
      }),
    },
  });
}

plugins.taskManager.registerTaskDefinitions({
  'workflow:apikey-cleanup': {
    title: 'Workflow API Key Cleanup',
    schedule: { interval: '2m' },
    createTaskRunner: () => ({
      run: async () => cleanupTerminalExecutionApiKeys(workflowExecutionRepository, esoClient),
    }),
  },
});
```

### Partition assignment

```typescript
const partitionIndex = (crc32(executionId) & 0x7fffffff) % N;
```

Stored as `partitionIndex` on the execution document at creation time — simpler than a Painless script at query time and avoids per-query hash computation.

### ESO type registration

```typescript
encryptedSavedObjects.registerType({
  type: 'workflow-execution-api-key',
  attributesToEncrypt: new Set(['apiKeyId', 'apiKeySecret']),
  attributesToIncludeInAAD: new Set(['executionId']),
});
```

## What Does Not Change

- `executeWorkflowStep` — continues to use an individual `workflow:run` task (single-step execution is user-driven and low volume).
- `ConcurrencyManager` — concurrency enforcement is pre-flight, unchanged.
- `StepIoService`, eviction, and the execution loop internals — zero changes.
- The public plugin contract (`WorkflowsExecutionEnginePluginStart`) — unchanged surface area.
- Child `workflow-execute` steps — the `isChildExecution` guard forces children into individual `workflow:run` tasks to avoid blocking the parent. Unchanged.
- `runWorkflow()` and `resumeWorkflow()` function signatures — unchanged; `runExecutionUnit` and `resumeExecutionUnit` are thin wrappers.

## What Gets Eliminated

| Current | Replaced by |
|---|---|
| `workflow:run` TM task (per execution) | Partition worker Query A (PENDING) |
| `workflow:resume` idle-timeout TM task | Partition worker Query A (`resumeAt <= now`) |
| `taskManager.runSoon()` in external resume path | `executionRepository.update({ resumeAt: now })` |
| `workflow:scheduled` TM task (per workflow) | Partition worker Query B (`nextRunAt <= now`) |
| `getWorkflowGlobalTimeoutResumeTaskId` stable task | `resumeAt` field on execution doc |

## Migration

1. Register the ESO type for `workflow-execution-api-key`.
2. Add `partitionIndex` and `resumeAt` fields to the execution document schema.
3. Add `nextRunAt` and `partitionIndex` fields to the workflow document schema.
4. Register partition worker tasks and the cleanup task. Gate behind `config.batchPartitions: 0` (disabled by default).
5. When `batchPartitions > 0`:
   - At scheduling time: create API key + ESO, skip the `workflow:run` task schedule call.
   - At HITL entry: write `resumeAt` instead of scheduling the idle-timeout resume task.
   - At external resume: write `resumeAt = now` instead of `taskManager.runSoon()`.
   - At workflow save with scheduled trigger: write `nextRunAt` instead of scheduling a `workflow:scheduled` task.
6. Roll N from 1 → target over several releases, measuring TM slot usage and execution latency.

## Risks and Open Questions

| Risk | Severity | Mitigation |
|---|---|---|
| OCC contention if TM deduplication fails | Low | OCC is the correctness backstop; TM stable-ID dedup prevents it in normal operation |
| Partition task crash leaves P executions stuck `running` | Medium | `resolveInterruptedPartitionTask` on retry; bounded by `maxAttempts: 3` |
| Memory OOM with high P×N | Medium | Configurable P; existing `eviction.minPayloadSize` caps per-execution footprint |
| ES API key quota exhaustion at sustained burst | Low–Medium | Default 25k limit is wide; eager cleanup in `handlePostExecutionLoop` minimizes lag |
| `.kibana` index write pressure from ESO creation | Medium | Parallelize ESO creation alongside execution doc creation; monitor index latency |
| ESO fetch latency at claim time | Low | One GET per claimed execution; sub-ms in practice |
| APM trace root becomes shared per partition | Low | Per-execution spans and labels remain intact |
| PENDING → picked up latency | Low | ≤ 500 ms poll interval + small backoff → p99 latency ≤ 1 s under load |
| API key lives past execution completion | Low | Key is internal only; cleanup runs every 2 min; eager cleanup in happy path |
| `nextRunAt` write conflict with workflow document edits | Low | Separate `scheduledAt` sub-document or OCC retry; write is low-frequency (once per schedule tick) |
| Scheduled workflow missed if partition is down during `nextRunAt` window | Low–Medium | Partition task is HA via TM dedup; OCC claim prevents double-run on recovery; backfill via `nextRunAt <= now` catches it on next cycle |

**Open questions:**

1. Does `coreStart.security.authc.apiKeys` expose a `create()` method to plugins, or only internally to TM? Verify it is part of the public `CoreStart` contract.
2. What is the right default for P (max in-flight per partition)? Suggest 10 to start, exposed as `config.batchPartitions.concurrencyPerPartition`.
3. Should N be static (registered at setup) or dynamic? Static is simpler; dynamic would require runtime task scheduling/removal.
4. Should `executeWorkflowStep` also adopt this path eventually? Currently low volume, so the individual task model is fine.
5. How should `nextRunAt` interact with the workflow document's model version? A `scheduledState` sub-object isolates scheduling fields from the main workflow definition and simplifies migration.

## Verdict

**Viable for all trigger types** with the per-execution ESO API key model.

The approach unifies the code path: there is no `triggeredBy` split, no dual execution model, no special-casing of manual vs. non-manual executions. Every execution goes through the same partition loop with the same `fakeRequest` reconstruction from a stored, encrypted API key.

The five pieces of new machinery needed:

1. ESO type `workflow-execution-api-key` + API key creation at scheduling time
2. `resumeAt` field on execution documents + updated HITL enter/external-resume paths
3. `nextRunAt` + `partitionIndex` fields on workflow documents + updated schedule save path
4. `resolveInterruptedPartitionTask` for partition crash recovery
5. `workflow:apikey-cleanup` recurring task

The three existing TM task types (`workflow:run`, `workflow:resume`, `workflow:scheduled`) are retired. Everything inside the execution engine — the loop, step implementations, concurrency manager, IO service — is unchanged.
