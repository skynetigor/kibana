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
  executePythonInConnector,
  killPythonProcessInConnector,
  tryExtractPythonOutputFromConnector,
} from './execute_python_in_connector';
import { remoteHostRunPythonStepCommonDefinition } from '../../../common/steps/remote_host';
import { createPollServerStepDefinition } from '../../step_registry/types';

const StateSchema = z.object({
  commandId: z.string(),
  pid: z.number(),
});

interface Deps {
  getActionsStart: () => ActionsPluginStartContract | undefined;
}

export const createRemoteHostRunPythonStepDefinition = ({ getActionsStart }: Deps) =>
  createPollServerStepDefinition({
    ...remoteHostRunPythonStepCommonDefinition,
    stateSchema: StateSchema,
    policy: {
      strategy: 'exponential',
      initialMs: 1000,
      maxMs: 5000,
    },
    ceilings: {
      maxAttempts: 20000,
      maxWaitMs: 60000,
    },
    start: async (context) => {
      const { code } = context.input;
      const { connectorId } = context.config;

      if (typeof code !== 'string' || code.trim().length === 0) {
        return { error: new Error('Code is required') };
      }

      const result = await executePythonInConnector({
        connectorId,
        request: context.contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        pythonCode: code,
        abortSignal: context.abortSignal,
      });

      if (result.stderr) {
        context.logger.error(result.stderr);
      }

      if (result.stdout) {
        context.logger.info(result.stdout);
      }

      if (result.status === 'running') {
        return { state: { commandId: result.commandId, pid: result.pid } };
      }

      return { output: result.output };
    },
    poll: async ({ config, state, contextManager, logger }) => {
      if (!state?.commandId) {
        throw new Error('Invalid state for polling remote Python execution');
      }

      const result = await tryExtractPythonOutputFromConnector({
        connectorId: config.connectorId,
        request: contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        commandId: state.commandId,
        pid: state.pid,
      });

      if (result.stderr) {
        logger.error(result.stderr);
      }

      if (result.stdout) {
        logger.info(result.stdout);
      }

      if (result.status === 'running') {
        return undefined;
      }

      return { output: result.output };
    },
    onCancel: async (context) => {
      const { config, contextManager } = context;
      const state = (context as { state?: z.infer<typeof StateSchema> }).state;

      if (!state?.commandId) {
        return;
      }

      await killPythonProcessInConnector({
        connectorId: config.connectorId,
        request: contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        commandId: state.commandId,
        pid: state.pid,
      });
    },
  });
