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
import { getEnclosingScopeRuntimes, parseDuration } from '../../utils';
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
      this.wfExecutionRuntimeManager.timeout();
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

    this.wfExecutionRuntimeManager.cancel();
  }
}
