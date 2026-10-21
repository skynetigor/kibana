/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreStart, Logger } from '@kbn/core/server';
import type { JsonValue } from '@kbn/utility-types';
import { ExecutionStatus } from '@kbn/workflows';
import { buildFieldsZodValidator } from '@kbn/workflows/spec/lib/build_fields_zod_validator';
import {
  applyInputDefaults,
  getInputsFromDefinition,
} from '@kbn/workflows/spec/lib/field_conversion';
import { executionIoId } from '../repositories/data_access_layer/implementations/executions_io/execution_io_id';
import type { ExecutionsIoClient } from '../repositories/data_access_layer/implementations/executions_io/executions_io_data_client';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import { safeOutputSize } from '../step/errors';
import { WorkflowTemplatingEngine } from '../templating_engine';
import {
  buildInputDefaultRenderContext,
  type WorkflowExecutionForInputRendering,
} from '../workflow_context_manager/build_workflow_context';
import type { ContextDependencies } from '../workflow_context_manager/types';

/**
 * Validates workflow inputs against the workflow's input schema.
 * On failure, marks the execution as FAILED with an InputValidationError.
 *
 * @returns true if inputs are valid and execution can proceed, false if validation failed
 */
export const validateWorkflowInputs = async (
  workflowExecution: WorkflowExecutionForInputRendering,
  workflowExecutionRepository: WorkflowExecutionRepository,
  logger: Logger,
  executionsIoDataClient: ExecutionsIoClient,
  coreStart?: CoreStart,
  dependencies?: ContextDependencies
): Promise<boolean> => {
  const persistWorkflowInput = async (value: unknown) => {
    if (!workflowExecution.id || value === undefined) {
      return;
    }
    const size = safeOutputSize(value) ?? 0;
    try {
      await executionsIoDataClient.bulkCreate({
        documents: [
          {
            executionId: workflowExecution.id,
            type: 'input',
            value: value as JsonValue,
            size,
          },
        ],
      });
    } catch (error) {
      logger.error(
        `Failed to store workflow input for execution ${workflowExecution.id}: ${error}`
      );
    }
    try {
      await workflowExecutionRepository.updateWorkflowExecution({
        id: workflowExecution.id,
        inputId: executionIoId('input', workflowExecution.id),
        inputSize: size,
      });
    } catch (error) {
      logger.error(
        `Failed to store workflow input size for execution ${workflowExecution.id}: ${error}`
      );
    }
    workflowExecution.context = {
      ...(workflowExecution.context ?? {}),
      inputs: value,
    };
  };

  if (!workflowExecution.workflowDefinition) {
    await persistWorkflowInput(workflowExecution.context?.inputs);
    return true;
  }
  const normalizedSchema = getInputsFromDefinition(workflowExecution.workflowDefinition);
  const validator = buildFieldsZodValidator(normalizedSchema);
  if (!normalizedSchema?.properties) {
    await persistWorkflowInput(workflowExecution.context?.inputs);
    return true;
  }
  const renderContext = buildInputDefaultRenderContext(workflowExecution, coreStart, dependencies);
  const templateEngine = new WorkflowTemplatingEngine({
    liquidSettings: workflowExecution.workflowDefinition.settings?.liquid,
  });

  // Caller-provided values are data. Evaluate only the explicit whole-expression
  // form and preserve ordinary strings that happen to resemble Liquid templates.
  const renderProvidedValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.startsWith('${{') && value.endsWith('}}')
        ? templateEngine.render(value, renderContext)
        : value;
    }

    if (Array.isArray(value)) {
      return value.map(renderProvidedValue);
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, renderProvidedValue(nestedValue)])
      );
    }

    return value;
  };

  let inputsWithDefaults: Record<string, unknown> | undefined;
  try {
    inputsWithDefaults = applyInputDefaults(
      renderContext.inputs,
      normalizedSchema,
      (value, source) =>
        source === 'default'
          ? templateEngine.render(value, renderContext)
          : renderProvidedValue(value)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistWorkflowInput(renderContext.inputs);
    try {
      await workflowExecutionRepository.updateWorkflowExecution({
        id: workflowExecution.id,
        status: ExecutionStatus.FAILED,
        error: {
          type: 'InputValidationError',
          message: `Workflow input validation failed: ${message}`,
        },
      });
    } catch (updateError) {
      logger.error(
        `Failed to mark execution ${workflowExecution.id} as FAILED after input validation error: ${updateError}`
      );
    }
    return false;
  }
  const result = validator.safeParse(inputsWithDefaults ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    await persistWorkflowInput(inputsWithDefaults ?? renderContext.inputs);
    try {
      await workflowExecutionRepository.updateWorkflowExecution({
        id: workflowExecution.id,
        status: ExecutionStatus.FAILED,
        error: {
          type: 'InputValidationError',
          message: `Workflow input validation failed: ${issues}`,
        },
      });
    } catch (updateError) {
      logger.error(
        `Failed to mark execution ${workflowExecution.id} as FAILED after input validation error: ${updateError}`
      );
    }

    return false;
  }

  await persistWorkflowInput(inputsWithDefaults);

  return true;
};
