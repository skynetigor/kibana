/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreStart } from '@kbn/core/server';
import type { ExitWorkflowNode } from '@kbn/workflows/graph';
import type { ContextDependencies } from '../../workflow_context_manager/types';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { WorkflowExecutionState } from '../../workflow_context_manager/workflow_execution_state';
import type { NodeImplementation } from '../node_implementation';

export class ExitWorkflowNodeImpl implements NodeImplementation {
  constructor(
    private node: ExitWorkflowNode,
    private wfExecutionRuntimeManager: WorkflowExecutionRuntimeManager,
    private workflowExecutionState: WorkflowExecutionState,
    private coreStart: CoreStart,
    private dependencies: ContextDependencies
  ) {}

  public async run(): Promise<void> {
    await this.wfExecutionRuntimeManager.finishWorkflowExecution();
  }
}
