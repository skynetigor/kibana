# Implementation Plan: TM `internalParallelism` + `workflow:run` wiring

Based on `rfc_task_manager_parallel_execution.md`.

---

## Context snapshot

`maxConcurrency` **already exists** in Task Manager:
- Defined in `task.ts:243` (`taskDefinitionSchema`) and `task_type_dictionary.ts:113` (`TaskRegisterDefinition`).
- Enforced via `CONCURRENCY_ALLOW_LIST_BY_TASK_TYPE` in `constants.ts:12`. Any task type setting `maxConcurrency` must be on that list or registration throws.
- Used by the `strategy_mget` claimer (`strategy_mget.ts:412`) to build separate ES queries for "limited" vs "unlimited" task types.

`internalParallelism` does **not** exist anywhere yet.

Internal system tasks (e.g., `task_manager:delete_inactive_background_task_nodes`) follow this pattern:
1. `registerXxxTaskDefinition(logger, core.getStartServices, this.definitions)` called in `setup()` at `plugin.ts:314`.
2. `scheduleXxxTask(logger, taskScheduling)` called in `start()` at `plugin.ts:529`.

All files are under `x-pack/platform/plugins/shared/task_manager/server/`.

---

## Phase 1 — Add `workflow:run` to the `maxConcurrency` allow list

**Why first**: `maxConcurrency` for `workflow:run` is the fairness fix. It already works; the only gate is the allow list.

### 1.1 — `constants.ts`

Add `workflow:run` and `workflow:resume` to `CONCURRENCY_ALLOW_LIST_BY_TASK_TYPE` (after `'ad_hoc_run-backfill'` at line 24):

```typescript
'workflow:run',
'workflow:resume',
```

### 1.2 — `workflows_execution_engine/server/plugin.ts`

In the `workflow:run` task definition registration, add:

```typescript
maxConcurrency: 8,   // tune based on load testing; 8 is the starting point from the RFC
```

**No other TM changes needed for Phase 1.** The existing claim loop already respects `maxConcurrency`.

---

## Phase 2 — Add `internalParallelism` to `TaskDefinition`

### 2.1 — `task.ts`

Add to `taskDefinitionSchema` after the `maxConcurrency` block (line 247):

```typescript
/**
 * When set, TM claims up to this many pending instances of this task type
 * and runs their runners concurrently within a single slot via Promise.all.
 * Requires the task type to have stateless, instance-independent runners.
 */
internalParallelism: schema.maybe(
  schema.number({
    min: 2,
  })
),
```

`TaskDefinition` is derived from `taskDefinitionSchema` via `TypeOf` (line 285), so it picks up the new field automatically.

### 2.2 — `task_type_dictionary.ts`

Add to `TaskRegisterDefinition` interface (after `maxConcurrency?: number` at line 113):

```typescript
internalParallelism?: number;
```

---

## Phase 3 — Extract shared OCC claim helper

The claim flow in `strategy_mget.ts` has two phases. Only the OCC claim phase (lines 178–246) is needed by the parallel-runner; the fetch phase is not (it is coupled to capacity math and partitioning that the parallel-runner does not use).

### New file `task_claimers/claim_task_batch.ts`

```typescript
export interface ClaimBatchResult {
  claimed: ConcreteTaskInstance[];
  conflicts: number;
  errors: number;
}

export const claimTaskBatch = async (
  taskStore: TaskStore,
  candidates: ConcreteTaskInstance[],
  definitions: TaskTypeDictionary,
  logger: Logger
): Promise<ClaimBatchResult> => {
  const now = new Date();
  const updates: PartialConcreteTaskInstance[] = candidates.map((task) => ({
    id: task.id,
    version: task.version,
    scheduledAt: task.retryAt != null && new Date(task.retryAt) < now ? task.retryAt : task.runAt,
    status: TaskStatus.Running,
    startedAt: now,
    attempts: task.attempts + 1,
    retryAt: getRetryAt(task, definitions.get(task.taskType)) ?? null,
    ownerId: taskStore.taskManagerId,
  }));

  const updateResults = await taskStore.bulkPartialUpdate(updates);
  const claimed: Record<string, PartialConcreteTaskInstance> = {};
  let conflicts = 0;
  let errors = 0;

  for (const result of updateResults) {
    if (isOk(result)) {
      claimed[result.value.id] = result.value;
    } else if (result.error.status === 409) {
      conflicts++;
    } else {
      logger.error(`claim error for ${result.error.id}: ${JSON.stringify(result.error.error)}`);
      errors++;
    }
  }

  const fullInstances = (await taskStore.bulkGet(Object.keys(claimed))).reduce<ConcreteTaskInstance[]>(
    (acc, r) => { if (isOk(r)) acc.push(r.value); return acc; },
    []
  );

  return { claimed: fullInstances, conflicts, errors };
};
```

### `strategy_mget.ts` — refactor

Replace the inline OCC claim block (lines 178–246) with:

```typescript
const { claimed: fullTasksToRun, conflicts, errors: bulkUpdateErrors } =
  await claimTaskBatch(taskStore, tasksToRun, definitions, logger);
```

No behaviour change — this is a pure extraction.

---

## Phase 4 — Implement the `taskManager:parallel-runner` system task

### 4.1 — `polling_lifecycle.ts`

Make `createTaskRunnerForTask` **public** (currently `private`, line 335). This allows `plugin.ts` to expose it as a factory for the parallel-runner without duplicating the construction logic.

### 4.2 — New files `parallel_runner/parallel_runner_task.ts` and `parallel_runner/index.ts`

**`registerParallelRunnerTaskDefinition` signature:**

```typescript
export function registerParallelRunnerTaskDefinition(
  logger: Logger,
  taskTypeDictionary: TaskTypeDictionary,
  getRunnerFactory: () => ((instance: ConcreteTaskInstance) => TaskManagerRunner) | undefined,
) {
  taskTypeDictionary.registerTaskDefinitions({
    [PARALLEL_RUNNER_TASK_TYPE]: {
      title: 'Task Manager: Parallel Runner',
      timeout: '365d',
      createTaskRunner: ({ taskInstance: systemInstance, signal }) => ({
        async run() {
          const runnerFactory = getRunnerFactory();
          if (!runnerFactory) {
            // start() sets this before any task can run; guard is defensive only
            throw new Error('[parallel-runner] task runner factory not ready');
          }
          await runParallelLoop({ logger, taskTypeDictionary, runnerFactory, signal });
          return { state: {}, runAt: new Date(Date.now() + 5_000) };
        },
        async cancel() {},
      }),
    },
  });
}
```

`getRunnerFactory` is a lazy getter — it returns `undefined` until `plugin.ts:start()` sets the field. Because `run()` is only called after `start()` completes, the guard is purely defensive.

**`runParallelLoop` — inner poll loop:**

```typescript
async function runParallelLoop({
  logger, taskTypeDictionary, runnerFactory, signal,
  taskStore,  // passed in from coreStartServices or plugin.ts
}: ...) {
  const parallelTypes = taskTypeDictionary
    .getAllDefinitions()
    .filter((def) => (def.internalParallelism ?? 1) > 1);

  while (!signal.aborted) {
    let anyWork = false;

    // Fetch all due instances across parallel types in one query
    const { docs } = await taskStore.fetch({
      query: {
        bool: {
          filter: [
            { terms: { 'task.taskType': parallelTypes.map((d) => d.type) } },
            { term: { 'task.status': 'idle' } },
            { range: { 'task.runAt': { lte: 'now' } } },
          ],
        },
      },
      // cap per type at its internalParallelism; sum gives the upper bound
      size: parallelTypes.reduce((sum, d) => sum + d.internalParallelism!, 0),
    });

    if (docs.length) {
      anyWork = true;
      const { claimed } = await claimTaskBatch(taskStore, docs, taskTypeDictionary, logger);
      if (claimed.length) {
        await runBatch({ claimed, runnerFactory, signal, logger });
      }
    }

    if (!anyWork) {
      await sleep(5_000, signal);
    }
  }
}
```

**`runBatch` — parallel execution:**

Each claimed instance gets a full `TaskManagerRunner`. `TaskManagerRunner.run()` handles the complete lifecycle: `fakeRequest` construction, `createTaskRunner` invocation, `processResult` (state persistence, retry scheduling, deletion), APM, and event logging — one event per sub-task, identical to a normal slot.

```typescript
async function runBatch({ claimed, runnerFactory, signal, logger }) {
  const runners = claimed.map((instance) => runnerFactory(instance));

  // markTaskAsRunning is a no-op for mget-claimed tasks (status already
  // set to 'running' during claimTaskBatch); transitions in-memory state only.
  await Promise.all(runners.map((r) => r.markTaskAsRunning()));

  // Propagate system-task abort into each sub-runner.
  signal.addEventListener('abort', () => runners.forEach((r) => r.cancel()), { once: true });

  // Run all concurrently; each runner handles its own error, retry, and deletion.
  await Promise.allSettled(runners.map((r) => r.run()));
}
```

**`scheduleParallelRunnerTask`:**

```typescript
export async function scheduleParallelRunnerTask(
  logger: Logger,
  taskScheduling: TaskScheduling
) {
  try {
    await taskScheduling.ensureScheduled({
      id: PARALLEL_RUNNER_TASK_ID,
      taskType: PARALLEL_RUNNER_TASK_TYPE,
      schedule: { interval: '5s' },
      state: {},
      params: {},
    });
  } catch (e) {
    logger.error(`Error scheduling ${PARALLEL_RUNNER_TASK_ID}: ${e.message}`);
  }
}
```

---

## Phase 5 — Wire up in `plugin.ts`

### `setup()` — register the task definition (line ~314)

```typescript
import { registerParallelRunnerTaskDefinition } from './parallel_runner';

// New private field on TaskManagerPlugin:
//   private parallelRunnerFactory?: (instance: ConcreteTaskInstance) => TaskManagerRunner;

registerParallelRunnerTaskDefinition(
  this.logger,
  this.definitions,
  () => this.parallelRunnerFactory,  // lazy getter — undefined until start() sets it
);
```

`enrichFakeRequest` is not passed separately: it is already captured inside each `TaskManagerRunner` instance that `runnerFactory` produces (via `TaskPollingLifecycle.createTaskRunnerForTask` which receives `this.enrichFakeRequest` at construction time in `start()`).

### `start()` — set factory + schedule (line ~499 and ~529)

```typescript
import { scheduleParallelRunnerTask } from './parallel_runner';

// After constructing taskPollingLifecycle:
this.parallelRunnerFactory =
  (instance) => this.taskPollingLifecycle!.createTaskRunnerForTask(instance);

// After constructing taskScheduling:
scheduleParallelRunnerTask(this.logger, taskScheduling).catch(() => {});
```

---

## Phase 6 — Exclude parallel types from main poll loop

### `task_claimers/strategy_mget.ts` — `buildClaimPartitions` (~line 405)

Add one line inside the type-sorting loop:

```typescript
for (const type of types) {
  const definition = definitions.get(type);
  if (definition == null) continue;
  if (excludedTaskTypes.has(type)) continue;

  // Skip types owned by the parallel-runner system task
  if ((definition.internalParallelism ?? 1) > 1) continue;

  // ... existing maxConcurrency logic unchanged ...
}
```

The main poll loop never claims instances of parallel types. Only `taskManager:parallel-runner` does.

---

## Phase 7 — Wire `workflow:run` in the workflows plugin

```typescript
plugins.taskManager.registerTaskDefinitions({
  [WORKFLOW_RUN_TASK_TYPE]: {
    title: 'Run Workflow',
    timeout: '365d',
    maxAttempts: 3,
    maxConcurrency: 8,         // fairness cap: at most 8 slots on this node
    internalParallelism: 20,   // effective concurrency: 8 × 20 = 160
    createTaskRunner: (...) => ({ ... }),  // unchanged
  },
});
```

`workflow:run` and `workflow:resume` must be on `CONCURRENCY_ALLOW_LIST_BY_TASK_TYPE` (Phase 1).

The `taskManager:parallel-runner` system task itself does **not** set `maxConcurrency` — it is a TM-internal task and must not be on the allow list. It occupies exactly one normal slot; the fan-out lives inside its `run()` body.

---

## File change summary

| File | Change |
|---|---|
| `task_manager/server/constants.ts` | Add `'workflow:run'`, `'workflow:resume'` to `CONCURRENCY_ALLOW_LIST_BY_TASK_TYPE` |
| `task_manager/server/task.ts` | Add `internalParallelism` to `taskDefinitionSchema` |
| `task_manager/server/task_type_dictionary.ts` | Add `internalParallelism?: number` to `TaskRegisterDefinition` |
| `task_manager/server/task_claimers/claim_task_batch.ts` | **New file** — shared OCC claim helper (`claimTaskBatch`) |
| `task_manager/server/task_claimers/strategy_mget.ts` | Replace inline claim block (lines 178–246) with `claimTaskBatch` call; add one-line `internalParallelism > 1` skip in `buildClaimPartitions` |
| `task_manager/server/parallel_runner/parallel_runner_task.ts` | **New file** — `taskManager:parallel-runner` system task |
| `task_manager/server/parallel_runner/index.ts` | **New file** — re-exports |
| `task_manager/server/polling_lifecycle.ts` | Make `createTaskRunnerForTask` public |
| `task_manager/server/plugin.ts` | Add `parallelRunnerFactory` field; register parallel-runner in `setup()`; set factory + schedule in `start()` |
| `workflows_execution_engine/server/plugin.ts` | Add `maxConcurrency: 8, internalParallelism: 20` to `workflow:run` |

---

## Testing plan

- **Unit**: `buildClaimPartitions` with a definition that has `internalParallelism > 1` — assert it lands in neither `unlimitedTypes` nor `limitedTypes`.
- **Unit**: `taskDefinitionSchema` validation — assert `internalParallelism: 1` throws (`min: 2`), `internalParallelism: 20` passes.
- **Unit**: `claimTaskBatch` — assert 409 conflicts are counted but not thrown; assert successful claims have correct `status: running`, `attempts + 1`, `startedAt`.
- **Integration**: Schedule 50 `workflow:run` tasks with `internalParallelism: 5` — assert all 50 complete and no more than 1 `taskManager:parallel-runner` slot is used.
- **Integration**: Crash the parallel-runner mid-batch — assert sub-task instances are reset to `idle` by TM's existing interrupt recovery and re-claimed on the next run.
- **Load test**: 1,000 `workflow:run` tasks with `maxConcurrency: 8, internalParallelism: 20` — assert Reporting and Alerting tasks are not starved (slot usage for other types remains nonzero throughout the burst).
