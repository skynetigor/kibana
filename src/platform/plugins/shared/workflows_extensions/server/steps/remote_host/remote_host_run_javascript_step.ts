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
import { remoteHostRunJavascriptStepCommonDefinition } from '../../../common/steps/remote_host';
import { createPollServerStepDefinition } from '../../step_registry/types';
import {
  executeJsInConnector,
  killJsProcessInConnector,
  tryExtractJsOutputFromConnector,
} from './execute_js_in_connector';

const StateSchema = z.object({
  commandId: z.string(),
  pid: z.number(),
});

interface Deps {
  getActionsStart: () => ActionsPluginStartContract | undefined;
}

export const createRemoteHostRunJavascriptStepDefinition = ({ getActionsStart }: Deps) =>
  createPollServerStepDefinition({
    ...remoteHostRunJavascriptStepCommonDefinition,
    stateSchema: StateSchema,
    start: async (context) => {
      const { code } = context.input;
      const connectorId = context.config['connector-id'];

      if (typeof code !== 'string' || code.trim().length === 0) {
        return { error: new Error('Code is required') };
      }

      const result = await executeJsInConnector({
        connectorId,
        request: context.contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        jsCode: code,
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
        throw new Error('Invalid state for polling remote JavaScript execution');
      }

      const result = await tryExtractJsOutputFromConnector({
        connectorId: config['connector-id'],
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

      await killJsProcessInConnector({
        connectorId: config['connector-id'],
        request: contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        commandId: state.commandId,
        pid: state.pid,
      });
    },
  });
