/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { processNodeStackMonitoring } from './process_node_stack_monitoring';
import { abortableTimeout, TimeoutAbortedError } from '../../utils';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionLoopParams } from '../types';

/**
 * Runs a monitoring loop that invokes monitor hooks on nodes in the current scope stack
 * every 500ms until the monitorAbortController is aborted.
 *
 * Traverses enclosing scopes from outermost to innermost, calling `monitor()` on each
 * node that implements `MonitorableNode`. Workflow-level cancellation and timeout are
 * handled by `EnterWorkflowNodeImpl`'s monitor hook.
 */
export async function runStackMonitor(
  params: WorkflowExecutionLoopParams,
  monitoredStepExecutionRuntime: StepExecutionRuntime,
  monitorAbortController: AbortController
): Promise<void> {
  while (!monitorAbortController.signal.aborted) {
    // Check cancellation immediately before waiting - ensures fast cancellation detection
    await processNodeStackMonitoring(params, monitoredStepExecutionRuntime);

    // If monitoring was aborted during the check, exit early
    if (monitorAbortController.signal.aborted) {
      return;
    }

    try {
      await abortableTimeout(500, monitorAbortController.signal);
    } catch (error) {
      if (error instanceof TimeoutAbortedError) {
        // Monitoring was aborted, exit early
        return;
      }

      throw error;
    }
  }
}
