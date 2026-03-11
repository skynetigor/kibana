## Model workflow as a container step with explicit enter/exit graph nodes

### Motivation

`WorkflowExecutionRuntimeManager` was overloaded — it owned start/finish lifecycle, timeout monitoring, telemetry reporting, logging, state transitions, and APM tracing. Workflow-level timeout was modeled as a generic timeout zone (`EnterWorkflowTimeoutZoneNodeImpl` / `ExitWorkflowTimeoutZoneNodeImpl`) rather than a first-class concept. The workflow itself had no graph-level representation as a container step. Cancellation detection lived in a standalone `cancelWorkflowIfRequested` function called from the monitoring loop, separate from other workflow-level concerns.

### Key design idea

Treat the workflow as a "super-step" — a container node that orchestrates inner steps, just like other container-like steps (`if`, `foreach`, `retry`, `while`, etc.). The execution graph now always starts with `enter-workflow` and ends with `exit-workflow`, giving the workflow the same enter/exit structure as every other composite step.

Just as `StepExecutionRuntime` manages the lifecycle of an individual step (start, finish, fail, cancel, wait), `WorkflowExecutionRuntimeManager` now serves as the equivalent "super-step runtime" for the workflow itself — managing its lifecycle via `start()`, `finish()`, `cancel()`, and `timeout()`. The workflow node implementations act as thin monitors that **detect** lifecycle conditions (timeout, cancellation), while the runtime manager **executes** the corresponding transitions. This separation keeps detection logic in the graph layer and orchestration logic in the runtime, mirroring how individual steps delegate their lifecycle to `StepExecutionRuntime`.

### Key changes

**1. New `enter-workflow` / `exit-workflow` graph nodes**

Introduced `EnterWorkflowNode` / `ExitWorkflowNode` graph node types. `build_execution_graph` now wraps the step sequence with these nodes. `EnterWorkflowNodeImpl` implements `MonitorableNode` to detect timeout and cancellation conditions. `ExitWorkflowNodeImpl` is a one-liner that delegates to `wfExecutionRuntimeManager.finish()`.

**2. Removed `EnterWorkflowTimeoutZoneNodeImpl` / `ExitWorkflowTimeoutZoneNodeImpl`**

These are replaced by the workflow nodes above. The workflow itself is the natural owner of its own timeout — it orchestrates everything inside it, so a separate timeout zone wrapper is redundant.

**3. `WorkflowExecutionRuntimeManager` as a super-step runtime with `cancel()`, `timeout()`, `finish()`, and `yieldResumeTask()`**

The runtime manager now mirrors `StepExecutionRuntime` at the workflow level: just as `StepExecutionRuntime` exposes `startStep()`, `finishStep()`, `failStep()`, `cancelStep()` for individual steps, the runtime manager exposes `start()`, `finish()`, `cancel()`, `timeout()`, `yieldResumeTask()` for the workflow. Each terminal method owns the full orchestration: abort the current step, fail/cancel all enclosing scopes via `getEnclosingScopeRuntimes`, set terminal status with `isExecuting: false`, report telemetry, and log. `yieldResumeTask()` stops the execution loop and schedules a task manager task to resume later, capping the resume time at the workflow timeout deadline if configured. It uses `StepExecutionRuntimeFactory.getOrCreateStepExecutionRuntime()` to obtain the current step's runtime for these operations. The runtime manager also owns `workflowTaskManager` and `fakeRequest` directly. APM tracing setup/teardown remains in the runtime manager; extracting APM into a dedicated class is planned as a follow-up.

**4. Deleted `cancel_workflow_if_requested.ts` and its test**

Cancellation detection moved into `EnterWorkflowNodeImpl.handleWorkflowCancellation()` via the monitor hook. When cancellation is detected, it calls `wfExecutionRuntimeManager.cancel()`. This consolidates all workflow-level monitoring (timeout + cancellation) into the workflow node's monitor, rather than splitting it between a standalone function and timeout zone nodes.

**5. `isExecuting` flag replaces status-based loop control**

Previously the execution loop checked `ExecutionStatus.RUNNING` to decide whether to continue. This coupled two unrelated concerns: task scheduling (should the loop keep running?) and workflow outcome (what happened?). Replacing it with a dedicated `isExecuting` boolean has several advantages:

- **Decouples task scheduling from workflow status.** The execution loop no longer depends on status to decide when to stop. Status is free to represent the workflow's outcome (`COMPLETED`, `FAILED`, `TIMED_OUT`, `CANCELLED`, `WAITING`) without affecting whether the current task continues running.
- **Allows status transitions during execution.** A workflow can be in any status (e.g. `WAITING`) while still actively executing within the current task. Previously, setting status to anything other than `RUNNING` would immediately terminate the loop, even if the task still had work to do (e.g. short in-memory delays).
- **Status no longer controls execution flow.** Steps and container nodes can update status for observability or persistence purposes without accidentally stopping the loop. The loop is only stopped by explicit `isExecuting: false` signals from lifecycle methods (`finish()`, `cancel()`, `timeout()`) or `yieldResumeTask()`.
- **Enables future execution fairness.** With `isExecuting` as an independent control signal, the engine can later introduce yield points — e.g. breaking the loop after a time threshold and scheduling a resume task — to improve task fairness and avoid long-running tasks monopolizing the task manager queue.

`isExecuting` is set to `true` before the loop starts and set to `false` by `finish()` (normal completion), `cancel()`, `timeout()`, or `yieldResumeTask()` (scheduling a resume task for delayed execution).

**6. Removed `workflow:resume` task definition**

Previously, resuming a paused workflow (e.g. after a delay step) required a dedicated task type with its own `resume()` code path. With the new model, `yieldResumeTask()` schedules a resume task and `setup_dependencies` loads persisted state and sets `isExecuting` / `currentNodeId` before entering the execution loop — the same entry point used for initial runs. The loop picks up from wherever `currentNodeId` points, so a separate resume path is no longer necessary; `workflow:scheduled` handles both initial and resumed executions.

**7. Extracted `getEnclosingScopeRuntimes` as a shared utility**

Walks the scope stack and returns step execution runtimes for all enclosing container steps. Used by the runtime manager's `cancel()` and `timeout()` methods, and by `processNodeStackMonitoring` for invoking monitor hooks on ancestor nodes.

### Other changes

- `NodesFactory` updated to instantiate the new workflow node types.
- `setup_dependencies` loads state and sets initial `isExecuting` / `currentNodeId` before the loop.
- `StepExecutionRuntimeFactory` gained `getOrCreateStepExecutionRuntime()` for reuse by the runtime manager.
- `processNodeStackMonitoring` simplified to use `getEnclosingScopeRuntimes` and no longer calls `cancelWorkflowIfRequested`.
- `handle_execution_delay` simplified — now calls `workflowRuntime.yieldResumeTask()` instead of manually coordinating `breakExecutionLoop()` + `workflowTaskManager.scheduleResumeTask()`.

### Why this is better

The workflow is now a first-class container step in the execution graph, consistent with how `if`, `foreach`, `retry`, and `while` are modeled. `WorkflowExecutionRuntimeManager` parallels `StepExecutionRuntime` at the workflow level — both provide a clean lifecycle API (`start`, `finish`, `cancel`, `timeout`) at their respective scopes. Lifecycle detection (timeout, cancellation) lives in the graph layer via `EnterWorkflowNodeImpl`'s monitor hook, while lifecycle execution lives in the runtime manager. This replaces the previous split where timeout was a generic timeout zone, cancellation was a standalone function in the monitoring loop, and telemetry/logging were scattered across multiple places. APM tracing setup/teardown remains in the runtime manager for now; extracting it into a dedicated class is planned as a follow-up to further improve separation of concerns.
