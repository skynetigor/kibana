# Implementation plan: per-node parallel runners

Reference: `rfc_per_node_parallel_runners.md`

---

## 1. Rename `parallelRunnerPartitions` → `systemTasksPerNode`

### `task_type_dictionary.ts`

```diff
-  parallelRunnerPartitions?: number;
+  systemTasksPerNode?: number;
```

Update the JSDoc comment accordingly.

### `task.ts`

```diff
-  parallelRunnerPartitions: schema.maybe(schema.number({ min: 1, max: 4 })),
+  systemTasksPerNode: schema.maybe(schema.number({ min: 1 })),
```

Remove the `max: 4` cap — `systemTasksPerNode` is unbounded (bounded only by the node's
`max_workers`).

Also update the `TaskInstance` / `ConcreteTaskInstance` field comment.

### `workflows_execution_engine/server/plugin.ts`

```diff
- parallelRunnerPartitions: 2,
+ systemTasksPerNode: 2,
```

---

## 2. `parallel_runner_task.ts` — scheduling

### Remove the fixed `TOTAL_PARTITIONS = 4` constant

The number of runner instances is now determined by the task definitions at startup, not a fixed
constant. Compute it by taking the maximum `systemTasksPerNode` across all registered definitions
that use `internalParallelism > 1`:

```typescript
function computeTotalRunners(taskTypeDictionary: TaskTypeDictionary): number {
  return taskTypeDictionary
    .getAllDefinitions()
    .filter((def) => (def.internalParallelism ?? 1) > 1)
    .reduce((max, def) => Math.max(max, def.systemTasksPerNode ?? 1), 1);
}
```

### Change `scheduleParallelRunnerTask` signature

```diff
  export async function scheduleParallelRunnerTask(
    logger: Logger,
    taskScheduling: TaskScheduling,
+   nodeId: string,
+   taskTypeDictionary: TaskTypeDictionary,
  )
```

### Change task IDs: embed `nodeId`

```diff
- const id = `${PARALLEL_RUNNER_TASK_ID}-${i}`;
+ const id = `${PARALLEL_RUNNER_TASK_ID}-${nodeId}-${i}`;
```

This ensures each node schedules its own distinct runner instances. TM's `ensureScheduled`
treats these as independent tasks; surviving nodes do not overwrite each other's runners.

### Loop count: `computeTotalRunners(taskTypeDictionary)` instead of `TOTAL_PARTITIONS`

```typescript
const totalRunners = computeTotalRunners(taskTypeDictionary);
for (let i = 0; i < totalRunners; i++) { ... }
```

### Pass `slotIndex` (not `partitionIndex`) in params

`partitionIndex` is renamed to `slotIndex` in params for clarity:

```diff
- params: { partitionIndex: i },
+ params: { slotIndex: i },
```

---

## 3. `parallel_runner_task.ts` — registration

### Add `taskPartitioner` and `nodeId` to `registerParallelRunnerTaskDefinition`

```diff
  export function registerParallelRunnerTaskDefinition(
    logger: Logger,
    taskTypeDictionary: TaskTypeDictionary,
    getRunnerFactory: () => TaskRunnerFactory | undefined,
    getTaskStore: () => TaskStore | undefined,
+   getTaskPartitioner: () => TaskPartitioner | undefined,
+   nodeId: string,
  )
```

Pass them down into `runParallelLoop`.

---

## 4. `parallel_runner_task.ts` — `runParallelLoop`

### Add `taskPartitioner` and `slotIndex` parameters

```diff
  async function runParallelLoop({
    logger,
    taskTypeDictionary,
    runnerFactory,
    taskStore,
    signal,
-   partitionIndex,
+   slotIndex,
+   taskPartitioner,
  }: { ... })
```

### Filter `parallelTypes` using `systemTasksPerNode`

```diff
- (def.internalParallelism ?? 1) > 1 && partitionIndex < (def.parallelRunnerPartitions ?? 1)
+ (def.internalParallelism ?? 1) > 1 && slotIndex < (def.systemTasksPerNode ?? 1)
```

### Add `task.partition` (node scope) to the fetch query

```typescript
const nodePartitions = taskPartitioner.getPartitions();
// nodePartitions is number[] — e.g. [0, 1, ..., 127] on node A

// If empty (node not yet partitioned), fall back to full range — same behaviour as strategy_mget.ts
const partitionFilter =
  nodePartitions.length > 0
    ? [{ terms: { 'task.partition': nodePartitions } }]
    : [];
```

Updated fetch query:

```typescript
const { docs } = await taskStore.fetch({
  query: {
    bool: {
      filter: [
        { bool: { should: typeFilters, minimum_should_match: 1 } },
        ...partitionFilter,                                      // node scope (new)
        { term:  { 'task.status': 'idle' } },
        { range: { 'task.runAt': { lte: 'now' } } },
      ],
    },
  },
  seq_no_primary_term: true,
});
```

`typeFilters` already narrows by `task.taskType` + `task.runnerPartition`; `partitionFilter` adds
the node scope on top.

> **Note:** `TaskPartitioner.getPartitions()` is currently `async` (it reads from
> `kibanaDiscoveryService`). If calling it inside the tight poll loop is expensive, cache the
> result per cycle (call it once at the top of `runParallelLoop`, before the `while` loop).

---

## 5. `plugin.ts` — wire the new parameters

### Pass `taskPartitioner` to `registerParallelRunnerTaskDefinition`

```diff
  registerParallelRunnerTaskDefinition(
    this.logger,
    this.definitions,
    () => this.parallelRunnerFactory,
    () => this.taskStore,
+   () => taskPartitioner,           // captured from start()
+   this.taskManagerId!,
  );
```

> `registerParallelRunnerTaskDefinition` is called in `setup()`, before `taskPartitioner` is
> created (which happens in `start()`). Use the same lazy getter pattern already used for
> `parallelRunnerFactory` and `taskStore`:
> ```typescript
> getTaskPartitioner: () => TaskPartitioner | undefined
> ```

### Pass `nodeId` and `taskTypeDictionary` to `scheduleParallelRunnerTask`

```diff
  scheduleParallelRunnerTask(
    this.logger,
    taskScheduling,
+   this.taskManagerId!,
+   this.definitions,
  ).catch(() => {});
```

---

## 6. `task.ts` — update `runnerPartition` comment

```diff
- * Assigned randomly at schedule time for task types with internalParallelism > 1.
+ * Assigned randomly at schedule time in [0, systemTasksPerNode) for task types with internalParallelism > 1.
```

---

## 7. `task_scheduling.ts` — update `assignRunnerPartition`

```diff
  private assignRunnerPartition(taskType: string): number | undefined {
    const def = this.definitions?.get(taskType);
-   const p = def?.parallelRunnerPartitions ?? 1;
+   const p = def?.systemTasksPerNode ?? 1;
    return p > 1 ? Math.floor(Math.random() * p) : undefined;
  }
```

---

## File change summary

| File | Change |
|---|---|
| `task_type_dictionary.ts` | `parallelRunnerPartitions` → `systemTasksPerNode`; remove `max: 4` |
| `task.ts` | Same rename in schema + comments |
| `parallel_runner_task.ts` | Dynamic runner count; node-prefixed IDs; `slotIndex`; `taskPartitioner` in fetch query |
| `plugin.ts` | Pass `nodeId`, `taskTypeDictionary`, lazy `taskPartitioner` getter |
| `task_scheduling.ts` | `parallelRunnerPartitions` → `systemTasksPerNode` in `assignRunnerPartition` |
| `workflows_execution_engine/server/plugin.ts` | `parallelRunnerPartitions: 2` → `systemTasksPerNode: 2` |

---

## Testing

1. Single node: `systemTasksPerNode: 2` → 2 runners scheduled with `taskManager:parallel-runner-{nodeId}-{0,1}`; both active; query includes full partition range `[0–255]`.
2. Two nodes: each schedules 2 runners; each runner's query includes only its node's half of the range; no cross-node task claiming.
3. Node failure: surviving node's runners pick up orphaned tasks once `TaskPartitioner` re-balances.
4. Benchmark: throughput should be identical to current `parallelRunnerPartitions: 2` on a single node.
