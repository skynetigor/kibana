/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { GraphNodeUnion } from '@kbn/workflows/graph';
import { runNode } from './run_node';
import type { WorkflowExecutionLoopParams } from './types';

/**
 * Executes the workflow execution loop, continuously running nodes while `isExecuting` is true.
 *
 * Each iteration processes a single node execution via `runNode`. The loop exits when
 * `isExecuting` is set to false by `finish()`, `cancel()` or `timeout()`.
 */
export async function executionFlowLoop(params: WorkflowExecutionLoopParams) {
  params.workflowRuntime.initialize();

  let previousNode: GraphNodeUnion | undefined;

  while (params.workflowRuntime.isExecuting) {
    const currentNode = params.workflowRuntime.getCurrentNode();

    if (previousNode?.id === currentNode?.id) {
      // Node should always transit to next node, if it doesn't, it's a loop and we should fail the workflow.
      params.workflowRuntime.fail(
        new Error('Infinite node execution detected. Workflow will be terminated.')
      );
      break;
    }

    await runNode(params);
    params.workflowRuntime.commit();
    previousNode = currentNode ?? undefined;
  }
}
