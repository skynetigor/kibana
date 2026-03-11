/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreStart } from '@kbn/core/server';
import { ExecutionStatus } from '@kbn/workflows';
import type { EsWorkflowExecution } from '@kbn/workflows';
import type { ExitWorkflowNode } from '@kbn/workflows/graph';
import type { WorkflowExecutionTelemetryClient } from '../../lib/telemetry/workflow_execution_telemetry_client';
import type { ContextDependencies } from '../../workflow_context_manager/types';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { WorkflowExecutionState } from '../../workflow_context_manager/workflow_execution_state';
import type { IWorkflowEventLogger } from '../../workflow_event_logger';
import type { NodeImplementation } from '../node_implementation';

export class ExitWorkflowNodeImpl implements NodeImplementation {
  constructor(
    private node: ExitWorkflowNode,
    private wfExecutionRuntimeManager: WorkflowExecutionRuntimeManager,
    private workflowExecutionState: WorkflowExecutionState,
    private coreStart: CoreStart,
    private dependencies: ContextDependencies,
    private workflowLogger: IWorkflowEventLogger,
    private telemetryClient?: WorkflowExecutionTelemetryClient
  ) {}

  public async run(): Promise<void> {
    await this.wfExecutionRuntimeManager.finishWorkflowExecution();
    this.reportTelemetryIfTerminal();
    this.logWorkflowComplete(
      this.wfExecutionRuntimeManager.getWorkflowExecutionStatus() === ExecutionStatus.COMPLETED
    );
  }

  /**
   * Reports telemetry for workflow execution when it reaches a terminal status.
   * Only reports once per execution to avoid duplicate events.
   */
  private reportTelemetryIfTerminal(): void {
    if (!this.telemetryClient) {
      return;
    }

    const workflowExecution = this.workflowExecutionState.getWorkflowExecution();

    const stepExecutions = this.workflowExecutionState.getAllStepExecutions();
    const finalWorkflowExecution = {
      ...workflowExecution,
    } as EsWorkflowExecution;

    this.telemetryClient.reportWorkflowExecutionTerminated({
      workflowExecution: finalWorkflowExecution,
      stepExecutions,
      finalStatus: workflowExecution.status,
    });
  }

  private logWorkflowComplete(success: boolean): void {
    this.workflowLogger?.logInfo(
      `Workflow execution ${success ? 'completed successfully' : 'failed'}`,
      {
        event: {
          action: 'workflow-complete',
          category: ['workflow'],
          outcome: success ? 'success' : 'failure',
        },
        tags: ['workflow', 'execution', 'complete'],
      }
    );
  }
}
