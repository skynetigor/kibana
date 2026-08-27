# RFC: Concurrency Lock Document

## Problem

The current concurrency check queries execution documents via `search` with `refresh: true` / `wait_for` to count active slots. This is expensive and has a soft over-admission window — two concurrent callers can both read `activeCount=0` and both proceed before either write is visible.

## Proposal

Introduce a dedicated `.workflows-execution-concurrency-locks` index. Each document represents one concurrency group:

```json
{
  "_id": "<concurrency-group-key>",
  "slots": ["exec-A", "exec-B"],
  "queued": ["exec-C", "exec-D"]
}
```

`slots` holds execution IDs currently occupying a slot. `queued` holds waiting executions in FIFO order. The document is created on first use via `upsert`.

## Acquire

A single atomic Painless script on the primary shard checks length and appends — no separate read step, no `refresh:true` needed (mget reads from primary directly). The script is idempotent: if the execution ID is already in `slots`, it is a no-op (safe for task retries).

For `drop`: if `slots.size() >= max`, set `ctx.op = 'none'` and signal the caller to mark the execution `SKIPPED`.

For `queue`: if `slots.size() >= max` and `queued.size() < queueSize`, append to `queued` and schedule a dormant task. If the queue is also full, mark `SKIPPED`.

For `cancel-in-progress`: atomically swap the oldest slot IDs out and add the new one, then cancel the evicted executions separately.

## Release + Promote (atomic)

On execution terminal transition, a single Painless script removes the finished ID from `slots` and, if `queued` is non-empty, moves `queued[0]` → `slots` and returns it as `promotedId`. The caller then calls `runSoon` on the promoted execution's dormant task.

This collapses the current queue drainer into the release operation — no separate search for next queued execution.

## Dormant Task Behavior

The dormant task fires either via `runSoon` (promotion) or at TTL expiry. On fire, it `mget`s the lock doc and branches on where the execution ID appears:

- In `queued`: TTL expired — remove from `queued` array, mark execution `SKIPPED`.
- In `slots`: was promoted but `runSoon` was missed (e.g. Kibana died mid-handoff) — proceed with execution.
- Neither: already completed or cancelled — noop.

## Orphan Handling

If Kibana dies mid-execution, Task Manager retries the task. The retry path already marks the execution `ABANDONED` and transitions it to a terminal status, which triggers the release script and frees the slot. No separate reconciliation job needed.
