/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { runNode } from './run_node';
import type { WorkflowExecutionLoopParams } from './types';

/**
 * Executes the workflow execution loop, continuously running nodes while `isExecuting` is true.
 *
 * Each iteration processes a single node execution via `runNode`. The loop exits when
 * `isExecuting` is set to false by `finish()`, `cancel()` or `timeout()`.
 */
export async function executionFlowLoop(params: WorkflowExecutionLoopParams) {
  await params.workflowRuntime.initialize();

  while (params.workflowRuntime.isExecuting) {
    await runNode(params);
    params.workflowRuntime.commit();
  }
}
