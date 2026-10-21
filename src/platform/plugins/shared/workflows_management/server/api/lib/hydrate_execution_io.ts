/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { EsWorkflowExecution, EsWorkflowStepExecution } from '@kbn/workflows';
import type { ExecutionsIoClient } from '@kbn/workflows-execution-engine/server/repositories/data_access_layer/implementations/executions_io/executions_io_data_client';

export interface HydrateExecutionIoParams {
  executionsIoDataClient: ExecutionsIoClient;
  workflowExecution?: EsWorkflowExecution;
  stepExecutions?: EsWorkflowStepExecution[];
  includeWorkflowIo?: boolean;
  includeInput?: boolean;
  includeOutput?: boolean;
}

/**
 * Fills requested input and output values from the executions IO data client.
 * Ids come from the execution documents. Missing IO leaves the payload unset.
 */
export async function hydrateExecutionIo({
  executionsIoDataClient,
  workflowExecution,
  stepExecutions = [],
  includeWorkflowIo = false,
  includeInput = false,
  includeOutput = false,
}: HydrateExecutionIoParams): Promise<void> {
  const ids: string[] = [];
  if (includeWorkflowIo && workflowExecution) {
    if (workflowExecution.inputId) {
      ids.push(workflowExecution.inputId);
    }
    if (workflowExecution.outputId) {
      ids.push(workflowExecution.outputId);
    }
  }
  for (const step of stepExecutions) {
    if (includeInput && step.inputId) {
      ids.push(step.inputId);
    }
    if (includeOutput && step.outputId) {
      ids.push(step.outputId);
    }
  }
  if (ids.length === 0) {
    return;
  }

  const { items } = await executionsIoDataClient.getByIds(ids);
  const values = new Map(items.map((item) => [item.document.id, item.document.value]));

  if (includeWorkflowIo && workflowExecution) {
    const inputs = workflowExecution.inputId ? values.get(workflowExecution.inputId) : undefined;
    const output = workflowExecution.outputId ? values.get(workflowExecution.outputId) : undefined;
    if (inputs !== undefined || output !== undefined) {
      workflowExecution.context = {
        ...(workflowExecution.context ?? {}),
        ...(inputs !== undefined ? { inputs } : {}),
        ...(output !== undefined ? { output } : {}),
      };
    }
  }

  for (const step of stepExecutions) {
    if (includeInput && step.inputId && values.has(step.inputId)) {
      step.input = values.get(step.inputId);
    }
    if (includeOutput && step.outputId && values.has(step.outputId)) {
      step.output = values.get(step.outputId);
    }
  }
}
