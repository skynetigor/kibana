/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { EnterWorkflowNode } from '@kbn/workflows/graph';
import { ExecutionStatus } from '@kbn/workflows/types/latest';
import { parseDuration } from '../../utils';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';
import type { StepExecutionRuntimeFactory } from '../../workflow_context_manager/step_execution_runtime_factory';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { WorkflowExecutionState } from '../../workflow_context_manager/workflow_execution_state';
import type { MonitorableNode, NodeImplementation } from '../node_implementation';

export class EnterWorkflowNodeImpl implements NodeImplementation, MonitorableNode {
  constructor(
    private node: EnterWorkflowNode,
    private wfExecutionRuntimeManager: WorkflowExecutionRuntimeManager,
    private stepExecutionRuntimeFactory: StepExecutionRuntimeFactory,
    private workflowExecutionState: WorkflowExecutionState
  ) {}

  public run(): void {
    this.workflowExecutionState.updateWorkflowExecution({
      status: ExecutionStatus.RUNNING,
      startedAt: new Date().toISOString(),
    });
    this.wfExecutionRuntimeManager.navigateToNextNode();
  }

  public monitor(monitoredStepExecutionRuntime: StepExecutionRuntime): void {
    if (!this.node.timeout) {
      return;
    }

    const timeoutMs = parseDuration(this.node.timeout);
    const whenStepStartedTime = new Date(
      this.wfExecutionRuntimeManager.getWorkflowExecution().startedAt
    ).getTime();
    const currentTimeMs = new Date().getTime();
    const currentStepDuration = currentTimeMs - whenStepStartedTime;

    if (currentStepDuration > timeoutMs) {
      const timeoutError = new Error('Failed due to workflow timeout');
      monitoredStepExecutionRuntime.abortController.abort();
      monitoredStepExecutionRuntime.failStep(timeoutError);

      let stack = monitoredStepExecutionRuntime.scopeStack;

      while (!stack.isEmpty()) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const currentScope = stack.getCurrentScope()!;
        stack = stack.exitScope();
        const scopeStepExecutionRuntime =
          this.stepExecutionRuntimeFactory.createStepExecutionRuntime({
            nodeId: currentScope.nodeId,
            stackFrames: stack.stackFrames,
          });

        if (scopeStepExecutionRuntime.stepExecution) {
          scopeStepExecutionRuntime.failStep(timeoutError);
        }
      }
      this.workflowExecutionState.updateWorkflowExecution({
        error: undefined,
        status: ExecutionStatus.TIMED_OUT,
      });
    }
  }
}
