/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { PluginStartContract as ActionsPluginStartContract } from '@kbn/actions-plugin/server';
import { z } from '@kbn/zod/v4';
import {
  executeJsInConnector,
  killProcessInConnector,
  tryExtractOutputFromConnector,
} from './execute_script_in_connector/execute_js_in_connector';
import { executeScriptInIsolate } from './execute_script_in_isolate';
import {
  CODE_EXECUTION_TIMEOUT_MS,
  CODE_MAX_CONSOLE_LOG_COUNT,
  CODE_MAX_LENGTH_CHARS,
  CODE_MAX_LENGTH_MB,
  CODE_MEMORY_LIMIT_MB,
  scriptsJavaScriptStepCommonDefinition,
} from '../../../common/steps/javascript';
import { createPollServerStepDefinition } from '../../step_registry/types';

const StateSchema = z.object({
  pid: z.string(),
  scriptPath: z.string(),
  outputPath: z.string(),
  logsPath: z.string(),
});

interface Deps {
  getActionsStart: () => ActionsPluginStartContract | undefined;
}

const toExecutionError = (error: unknown, aborted: boolean): Error => {
  if (aborted) {
    return new Error('Step execution was cancelled');
  }

  if (error instanceof Error) {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return new Error(error.message);
  }

  return new Error('Script execution failed');
};

export const createScriptsJavaScriptStepDefinition = ({ getActionsStart }: Deps) =>
  createPollServerStepDefinition({
    ...scriptsJavaScriptStepCommonDefinition,
    stateSchema: StateSchema,
    start: async (context) => {
      const { code } = context.input;
      const { connectorId } = context.config;

      if (typeof code !== 'string' || code.trim().length === 0) {
        return { error: new Error('Code is required') };
      }

      if (code.length > CODE_MAX_LENGTH_CHARS) {
        return {
          error: new Error(
            `Code exceeds maximum allowed size of ${CODE_MAX_LENGTH_MB} MB after template rendering. Current size: ${(
              code.length /
              1024 /
              1024
            ).toFixed(2)} MB. Reduce interpolated data or split the workflow.`
          ),
        };
      }

      if (connectorId) {
        const executeJsResult = await executeJsInConnector({
          connectorId,
          request: context.contextManager.getFakeRequest(),
          actionsStart: getActionsStart(),
          jsCode: code,
        });

        if (executeJsResult.status === 'running') {
          return {
            state: {
              pid: executeJsResult.pid,
              scriptPath: executeJsResult.scriptPath,
              outputPath: executeJsResult.outputPath,
              logsPath: executeJsResult.logsPath,
            },
          };
        }

        return { output: executeJsResult.output };
      }

      try {
        const output = await executeScriptInIsolate({
          script: code,
          logger: context.logger,
          abortSignal: context.abortSignal,
          memoryLimitMb: CODE_MEMORY_LIMIT_MB,
          executionTimeoutMs: CODE_EXECUTION_TIMEOUT_MS,
          maxConsoleLogCount: CODE_MAX_CONSOLE_LOG_COUNT,
        });

        return { output };
      } catch (error) {
        return {
          error: toExecutionError(error, context.abortSignal.aborted),
        };
      }
    },
    poll: async ({ config, state, contextManager }) => {
      if (!state || !state.pid || !state.scriptPath || !state.outputPath || !state.logsPath) {
        throw new Error('Invalid state for polling script execution in connector');
      }

      const { connectorId } = config;

      if (!connectorId) {
        throw new Error('Connector ID is required for polling script execution in connector');
      }

      const scriptResult = await tryExtractOutputFromConnector({
        connectorId,
        request: contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        pid: state.pid,
        scriptPath: state.scriptPath,
        outputPath: state.outputPath,
      });

      if (scriptResult.status === 'running') {
        return undefined;
      }

      return { output: scriptResult.output };
    },
    onCancel: async ({ config, state, contextManager }) => {
      if (!state || !state.pid) {
        return;
      }

      const { connectorId } = config;

      if (!connectorId) {
        throw new Error('Connector ID is required for cancelling script execution in connector');
      }

      await killProcessInConnector({
        connectorId,
        request: contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        pid: state.pid,
      });
    },
  });
