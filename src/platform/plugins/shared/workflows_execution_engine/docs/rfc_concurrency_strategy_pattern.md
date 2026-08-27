# RFC: Concurrency Strategy Pattern

## Problem

Concurrency logic is scattered across `concurrency_manager.ts`, `concurrency_queue_drainer.ts`, `handle_queued_workflow_run_at_task_start.ts`, `maybe_schedule_dormant_queued_run.ts`, and `plugin.ts`. Adding or modifying a strategy requires touching multiple files with no clear ownership boundary.

## Proposal

Model each concurrency strategy as a self-contained class implementing a `ConcurrencyStrategy` interface with optional lifecycle hooks. Each strategy owns only what it needs.

```typescript
interface ConcurrencyStrategy {
  initSetup?(core: CoreSetup): void;
  initStart?(core: CoreStart): void;
  getTaskDefinitions?(): TaskDefinition[];

  onSchedule(ctx: ScheduleContext): Promise<ConcurrencyDecision>;
  onStart?(ctx: StartContext): Promise<void>;
  onFinish?(ctx: FinishContext): Promise<void>;
  onFinalize?(ctx: FinalizeContext): Promise<void>;
}
```

`onSchedule` is the admission gate — required. The rest are optional; a strategy only implements what its lifecycle demands.

## Strategies

**`DropStrategy`** — implements `onSchedule` only. Acquires a slot or signals `SKIPPED`. Nothing else needed.

**`CancelInProgressStrategy`** — implements `onSchedule` (acquire, evict oldest) and `onFinish` (release slot).

**`QueueStrategy`** — implements all hooks. `onSchedule` adds to the `queued` array or signals `SKIPPED`. `onStart` checks whether the execution was promoted or fired at TTL expiry. `onFinish` releases the slot and atomically promotes the next queued execution. `getTaskDefinitions` returns the dormant task definition — the dormant task is owned entirely by this strategy.

## Shared Infrastructure

The lock document index (`.workflows-execution-concurrency-locks`) is shared across all strategies — it is registered in `initSetup` of a base class or injected as a dependency, not owned by any single strategy.

## Orchestrator

A `ConcurrencyOrchestrator` reads the workflow's configured strategy, resolves the right instance, and delegates:

```typescript
class ConcurrencyOrchestrator {
  onSchedule(ctx) { return this.resolve(ctx).onSchedule(ctx); }
  onFinish(ctx)   { return this.resolve(ctx).onFinish?.(ctx); }
  // ...
}
```

`plugin.ts` calls `orchestrator.onSchedule(ctx)` at each entry point — no concurrency logic leaks into `plugin.ts`. Task definitions are collected via `strategies.flatMap(s => s.getTaskDefinitions?.() ?? [])` at setup time.

## Scheduled Workflow Non-Reentrance

Scheduled workflows currently have separate logic to prevent a new trigger from starting while the previous run is still executing. This is semantically identical to `drop, max=1` and can be unified under the same orchestrator.

The orchestrator computes a default key and strategy when the workflow has no user-defined concurrency setting:

```typescript
concurrencyKey = userDefinedKey ?? `workflow:scheduled:<workflowId>:<triggerId>`;
strategy       = userDefinedStrategy ?? new DropStrategy({ max: 1 });
```

The separate reentrance logic in the scheduled task runner is deleted. All admission control — manual, alert, and scheduled triggers — goes through the same orchestrator with the same lifecycle.

## Benefits

- Each strategy is fully self-contained — open one file, see everything for that strategy.
- Adding a new strategy is zero-touch to `plugin.ts` and existing strategies.
- The "forgot to call the concurrency check" failure mode is eliminated — there is one thing to wire per entry point.
- Task types are declared by the strategy that needs them, not hardcoded in plugin setup.
- Scheduled non-reentrance is no longer a special case — it is `drop, max=1` with an implicit key.
