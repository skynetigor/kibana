# Per-node parallel runners

## Problem

The current parallel-runner system schedules a fixed number of global system tasks (4 instances,
`taskManager:parallel-runner-{0,1,2,3}`). Any Kibana node can claim any of these instances, and
they query the full pool of tasks without regard for which node is hosting them.

This has two consequences:

1. **Capacity doesn't scale with nodes.** In a 3-node cluster the same 4 runners exist; adding
   nodes does not increase throughput for `internalParallelism` task types.
2. **Cross-node ES write contention.** Multiple runners on different nodes compete for the same
   task documents, producing OCC conflicts and wasted claim cycles.

---

## Goal

Allow a task definition to declare how many parallel-runner slots it wants dedicated **per node**.
With `systemTasksPerNode: 2` and 3 nodes, 6 runner slots are active — 2 per node — and the
throughput of that task type scales linearly with cluster size.

---

## Design

### New task definition field: `systemTasksPerNode`

Replaces `parallelRunnerPartitions`.

```typescript
interface TaskRegisterDefinition {
  internalParallelism?: number;   // concurrent executions per runner slot (unchanged)
  systemTasksPerNode?: number;    // parallel-runner slots to reserve per Kibana node (default 1)
}
```

`internalParallelism: 20, systemTasksPerNode: 2` → each node runs 2 runners × 20 concurrent slots
= 40 concurrent executions per node. With N nodes: N × 40 total.

---

### Node-local scheduling (no pinning)

On `start()` each Kibana node calls `scheduleParallelRunnerTask` with IDs that include its own
node ID:

```
taskManager:parallel-runner-{nodeId}-{0..systemTasksPerNode-1}
```

Node A (`nodeId = abc`) with `systemTasksPerNode: 2`:
- `taskManager:parallel-runner-abc-0`
- `taskManager:parallel-runner-abc-1`

Node B (`nodeId = xyz`) independently schedules:
- `taskManager:parallel-runner-xyz-0`
- `taskManager:parallel-runner-xyz-1`

**Crucially, no `task.partition` is set on these tasks.** They are global floating tasks, just like
the existing 4 static runners. TM's normal load-balancing distributes them across nodes.

---

### Node-aware task queries (runtime, not scheduling)

The node-awareness is applied **when a runner executes**, not when it is scheduled. When
`runParallelLoop` runs it:

1. Reads the current node's partition range from `TaskPartitioner.getPartitions()`.
2. Includes that range in the `workflow:run` fetch query.
3. Also filters by `runnerPartition` (the slot index within this node) for intra-node distribution.

```typescript
const nodePartitions = await taskPartitioner.getPartitions();   // e.g. [0..127] on node A

const { docs } = await taskStore.fetch({
  query: {
    bool: {
      filter: [
        { term:  { 'task.taskType':      'workflow:run' } },
        { terms: { 'task.partition':     nodePartitions } },   // node scope
        { term:  { 'task.runnerPartition': slotIndex   } },   // intra-node slot
        { term:  { 'task.status':        'idle'        } },
        { range: { 'task.runAt':         { lte: 'now' } } },
      ],
    },
  },
  seq_no_primary_term: true,
});
```

`task.partition` on `workflow:run` tasks is already set at schedule time by `task_store.ts` via
`murmurhash(id) % 256`. This is the same field used by TM's main poll loop to distribute ordinary
tasks across nodes — here we reuse it to scope runner queries to their host node.

---

### Two-level routing

| Field | Range | Meaning |
|---|---|---|
| `task.partition` | 0–255 | Which Kibana node owns this task (existing TM mechanism) |
| `task.runnerPartition` | 0–(systemTasksPerNode-1) | Which of that node's runner slots claims it |

Both fields are assigned randomly at schedule time (in `TaskScheduling.schedule`).
Together they guarantee that every task is owned by exactly one (node, slot) pair — no
cross-node or cross-slot contention.

---

### Recovery: node failure

Because system tasks are **not** pinned to their scheduling node, failure is graceful:

1. Node A crashes. Its runners (`runner-abc-0`, `runner-abc-1`) become orphaned.
2. TM's ownership timeout expires; runners are reset to `idle`.
3. Node B claims and runs them. Node B's `TaskPartitioner` now also covers node A's former
   partition range (TM re-balances partition ownership after a node disappears).
4. Node B's runners query `task.partition ∈ nodeB_partitions` — which now includes the
   re-assigned range — so node A's pending `workflow:run` tasks are automatically processed.
5. No manual intervention, no stranded tasks.

This is exactly the same recovery story as ordinary TM tasks and as the existing 4 static runners.

---

### Comparison with previous RFC (pinned runners)

| | Pinned runners (discarded) | Global runners (this doc) |
|---|---|---|
| System task partition | Set to owner node's range | Not set (floats freely) |
| Node failure | Tasks in dead node's range are stranded | Surviving nodes absorb orphaned runners + re-balanced partition range |
| Implementation risk | High | Same as current system |
| Throughput scaling | Linear with nodes ✓ | Linear with nodes ✓ |
| Zero cross-node contention | ✓ (when healthy) | ✓ (when healthy) |

---

## What changes from the current implementation

| Component | Current | New |
|---|---|---|
| Task definition | `parallelRunnerPartitions: 1–4` | `systemTasksPerNode: N` |
| Runner count | 4 global static IDs | N × nodeCount, node-prefixed IDs |
| Runner scheduling | Once at startup, static IDs | Each node schedules its own N on startup |
| Runner fetch query | `runnerPartition == i` | `partition ∈ nodeRange AND runnerPartition == i` |
| `task.runnerPartition` range | 0–(parallelRunnerPartitions-1) | 0–(systemTasksPerNode-1) |
| Node affinity | None | Implicit via `task.partition` at query time |

`parallelRunnerPartitions` can be kept as a deprecated alias that maps to `systemTasksPerNode`
during a transition period, or removed in the same change.

---

## Open questions

1. **`taskPartitioner.getPartitions()` availability inside `runParallelLoop`** — `TaskPartitioner`
   is currently used in `strategy_mget.ts`. It needs to be passed through to the parallel runner,
   either via the plugin wiring or as a new parameter on `runParallelLoop`.

2. **Uniform `runnerPartition` distribution** — `task.runnerPartition` is currently assigned
   randomly (uniform over `[0, systemTasksPerNode)`). Since `task.partition` already distributes
   tasks evenly across nodes, the intra-node distribution should also be approximately uniform.
   Worth verifying under load with metrics.

3. **Node ID source** — the node ID used for runner task IDs should be the same value as
   `taskStore.taskManagerId` to stay consistent with existing TM identifiers.
