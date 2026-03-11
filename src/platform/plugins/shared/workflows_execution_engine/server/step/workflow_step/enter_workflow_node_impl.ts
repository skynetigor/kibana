/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { EnterWorkflowNode } from '@kbn/workflows/graph';
import { ExecutionError } from '@kbn/workflows/server';
import { ExecutionStatus } from '@kbn/workflows/types/latest';
import type { WorkflowExecutionRepository } from '../../repositories/workflow_execution_repository';
import { parseDuration } from '../../utils';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';
import type { StepExecutionRuntimeFactory } from '../../workflow_context_manager/step_execution_runtime_factory';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { WorkflowExecutionState } from '../../workflow_context_manager/workflow_execution_state';
import type { IWorkflowEventLogger } from '../../workflow_event_logger';
import type { MonitorableNode, NodeImplementation } from '../node_implementation';

export class EnterWorkflowNodeImpl implements NodeImplementation, MonitorableNode {
  constructor(
    private node: EnterWorkflowNode,
    private wfExecutionRuntimeManager: WorkflowExecutionRuntimeManager,
    private stepExecutionRuntimeFactory: StepExecutionRuntimeFactory,
    private workflowExecutionState: WorkflowExecutionState,
    private workflowLogger: IWorkflowEventLogger,
    private workflowExecutionRepository: WorkflowExecutionRepository
  ) {}

  public async run(): Promise<void> {
    this.logWorkflowStart();
    await this.wfExecutionRuntimeManager.start();
    this.wfExecutionRuntimeManager.navigateToNextNode();
  }

  public async monitor(monitoredStepExecutionRuntime: StepExecutionRuntime): Promise<void> {
    await this.handleWorkflowCancellation(monitoredStepExecutionRuntime);
    this.handleWorkflowTimeout(monitoredStepExecutionRuntime);
  }

  private handleWorkflowTimeout(monitoredStepExecutionRuntime: StepExecutionRuntime): void {
    if (!this.node.timeout) {
      return;
    }

    const timeoutMs = parseDuration(this.node.timeout);
    const whenWorkflowStartedTime = new Date(
      this.wfExecutionRuntimeManager.getWorkflowExecution().startedAt
    ).getTime();
    const currentTimeMs = new Date().getTime();
    const currentWorkflowDuration = currentTimeMs - whenWorkflowStartedTime;

    if (currentWorkflowDuration > timeoutMs) {
      const timeoutError = new ExecutionError({
        type: 'WorkflowTimeoutError',
        message: `Workflow timed out after ${currentWorkflowDuration}ms`,
      });
      monitoredStepExecutionRuntime.abortController.abort();
      monitoredStepExecutionRuntime.failStep(timeoutError);
      this.getEnclosingScopeRuntimes(monitoredStepExecutionRuntime).forEach((step) =>
        step.failStep(timeoutError)
      );

      this.terminateWorkflow({ status: ExecutionStatus.TIMED_OUT });
    }
  }

  private async handleWorkflowCancellation(monitoredStepExecutionRuntime: StepExecutionRuntime) {
    if (!this.workflowExecutionState.getWorkflowExecution().cancelRequested) {
      try {
        const currentExecution = await this.workflowExecutionRepository.getWorkflowExecutionById(
          this.workflowExecutionState.getWorkflowExecution().id,
          this.workflowExecutionState.getWorkflowExecution().spaceId
        );

        if (!currentExecution?.cancelRequested) {
          return;
        }
      } catch (error) {
        // If the cancellation check fails (e.g., network timeout, Elasticsearch unavailable),
        // log the error but don't throw. This prevents infrastructure issues from causing
        // step execution failures. The workflow will continue executing, and cancellation
        // will be checked again on the next monitoring cycle.
        this.workflowLogger.logError(
          'Failed to check workflow cancellation status - continuing execution',
          error instanceof Error ? error : new Error(String(error))
        );
        return;
      }
    }

    monitoredStepExecutionRuntime.abortController.abort();
    monitoredStepExecutionRuntime.cancelStep();
    this.getEnclosingScopeRuntimes(monitoredStepExecutionRuntime).forEach((step) =>
      step.cancelStep()
    );
    this.terminateWorkflow({ status: ExecutionStatus.CANCELLED });
  }

  /**
   * Gets the step execution runtimes of the enclosing scopes of the current step execution runtime.
   * The enclosing scopes are the scopes that are enclosing the current step execution runtime.
   * For example, if the current step execution runtime is in a scope that is enclosed by another scope,
   * the enclosing scope runtimes will be the step execution runtimes of the enclosing scope.
   * @param currentStepExecutionRuntime - The step execution runtime of the current step
   * @returns The step execution runtimes of the enclosing scopes
   */
  private getEnclosingScopeRuntimes(
    currentStepExecutionRuntime: StepExecutionRuntime
  ): StepExecutionRuntime[] {
    let stack = currentStepExecutionRuntime.scopeStack;
    const result: StepExecutionRuntime[] = [];

    while (!stack.isEmpty()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const currentScope = stack.getCurrentScope()!;
      stack = stack.exitScope();
      const scopeStepExecutionRuntime = this.stepExecutionRuntimeFactory.createStepExecutionRuntime(
        {
          nodeId: currentScope.nodeId,
          stackFrames: stack.stackFrames,
        }
      );
      result.push(scopeStepExecutionRuntime);
    }

    return result;
  }

  private terminateWorkflow({
    status,
    error,
  }: {
    status: ExecutionStatus;
    error?: ExecutionError;
  }): void {
    this.workflowExecutionState.updateWorkflowExecution({
      status,
      isExecuting: false,
      finishedAt: new Date().toISOString(),
      error,
      duration:
        new Date().getTime() -
        new Date(this.workflowExecutionState.getWorkflowExecution().startedAt).getTime(),
    });
  }

  private logWorkflowStart(): void {
    this.workflowLogger?.logInfo('Workflow execution started', {
      event: { action: 'workflow-start', category: ['workflow'] },
      tags: ['workflow', 'execution', 'start'],
    });
  }
}
