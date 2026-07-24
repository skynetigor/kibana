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
import { remoteHostRunPythonStepCommonDefinition } from '../../../common/steps/remote_host';
import { createPollServerStepDefinition } from '../../step_registry/types';
import {
  executeCommandInConnector,
  killCommandInConnector,
  tryExtractCommandOutputFromConnector,
} from './execute_in_connector';

const StateSchema = z.object({
  commandId: z.string(),
  pid: z.number(),
});

interface Deps {
  getActionsStart: () => ActionsPluginStartContract | undefined;
}

const buildPythonBashScript = (pythonCode: string): string => {
  const encoded = Buffer.from(pythonCode).toString('base64');
  return `#!/bin/bash
printf '%s' '${encoded}' | openssl base64 -d -A | python3 -
exit $?`;
};

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

      const result = await executeCommandInConnector({
        connectorId,
        request: context.contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        bashScript: buildPythonBashScript(code),
        abortSignal: context.abortSignal,
      });

      if (result.status === 'running') {
        return { state: { commandId: result.commandId, pid: result.pid } };
      }

      return { output: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode } };
    },
    poll: async ({ config, state, contextManager }) => {
      if (!state?.commandId) {
        throw new Error('Invalid state for polling remote Python execution');
      }

      const result = await tryExtractCommandOutputFromConnector({
        connectorId: config.connectorId,
        request: contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        commandId: state.commandId,
        pid: state.pid,
      });

      if (result.status === 'running') {
        return undefined;
      }

      return { output: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode } };
    },
    onCancel: async (context) => {
      const { config, contextManager } = context;
      const state = (context as { state?: z.infer<typeof StateSchema> }).state;

      if (!state?.commandId) {
        return;
      }

      await killCommandInConnector({
        connectorId: config.connectorId,
        request: contextManager.getFakeRequest(),
        actionsStart: getActionsStart(),
        commandId: state.commandId,
        pid: state.pid,
      });
    },
  });
