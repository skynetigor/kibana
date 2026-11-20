/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { PluginStartContract as ActionsPluginStartContract } from '@kbn/actions-plugin/server';
import { ExecutionError } from '@kbn/workflows/server';
import { z } from '@kbn/zod/v4';
import type { ConnectorCallContext } from './execute_in_connector';
import { peelLeadingImports } from './peel_leading_imports';
import type { RemoteHostJobStatus } from './remote_host_job';
import { killJob, parseScriptOutput, pollJob, startJob } from './remote_host_job';
import { remoteHostJavascriptStepCommonDefinition } from '../../../common/steps/remote_host';
import { createPollServerStepDefinition } from '../../step_registry/types';

const StateSchema = z.object({
  jobId: z.string(),
  stdoutOffset: z.number().default(0),
  stderrOffset: z.number().default(0),
});

interface Deps {
  getActionsStart: () => ActionsPluginStartContract | undefined;
}

// Leading imports stay at module scope. The rest runs in an async function so
// `return` and `await` work, and `require` is still available inside that function.
export const buildRemoteHostJavascriptScript = (code: string): string => {
  const { imports, body } = peelLeadingImports(code);
  const program = `
import { createRequire as __wfCreateRequire } from 'node:module';
import { writeFileSync as __wfWriteFileSync } from 'node:fs';
import { dirname as __wfDirname } from 'node:path';
import { fileURLToPath as __wfFileURLToPath } from 'node:url';
const require = __wfCreateRequire(import.meta.url);
const __filename = __wfFileURLToPath(import.meta.url);
const __dirname = __wfDirname(__filename);
${imports}
try {
  const __wfResult = await (async () => {
${body}
  })();
  if (__wfResult !== undefined) {
    __wfWriteFileSync(process.env.STEP_OUTPUT, JSON.stringify(__wfResult));
  }
} catch (__wfError) {
  process.stderr.write((__wfError && __wfError.stack) || String(__wfError));
  process.exit(1);
}
`.trim();

  return `cat > "$WORKDIR/step.mjs" << 'ENDOFSCRIPT'
${program}
ENDOFSCRIPT
node "$WORKDIR/step.mjs"`;
};

const logCommandStreams = (
  logger: { info: (message: string) => void; warn: (message: string) => void },
  result: RemoteHostJobStatus
): void => {
  if (result.stdout) logger.info(result.stdout);
  if (result.stderr) logger.warn(result.stderr);
};

const completeCommand = (
  logger: { info: (message: string) => void; warn: (message: string) => void },
  result: RemoteHostJobStatus
): { output: unknown } => {
  logCommandStreams(logger, result);

  if (result.exitCode !== 0) {
    throw new ExecutionError({
      type: 'ScriptExecutionError',
      message: result.stderr || `Script exited with code ${result.exitCode}`,
      details: { exitCode: result.exitCode },
    });
  }

  return { output: parseScriptOutput(result.output) };
};

const toConnectorContext = (
  connectorId: string,
  context: {
    contextManager: { getFakeRequest: () => ConnectorCallContext['request'] };
    abortSignal: AbortSignal;
  },
  getActionsStart: () => ActionsPluginStartContract | undefined
): ConnectorCallContext => ({
  connectorId,
  request: context.contextManager.getFakeRequest(),
  actionsStart: getActionsStart(),
  abortSignal: context.abortSignal,
});

export const createRemoteHostJavascriptStepDefinition = ({ getActionsStart }: Deps) =>
  createPollServerStepDefinition({
    ...remoteHostJavascriptStepCommonDefinition,
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
      const { code, env, cwd } = context.input;
      const connectorId = context.config['connector-id'];

      if (typeof code !== 'string' || code.trim().length === 0) {
        return { error: new Error('Code is required') };
      }

      const maxBytes = context.maxStepSizeBytes ?? 0;
      const result = await startJob(
        toConnectorContext(connectorId, context, getActionsStart),
        buildRemoteHostJavascriptScript(code),
        env,
        cwd,
        maxBytes
      );

      if (result.status === 'running') {
        logCommandStreams(context.logger, result);
        return {
          state: {
            jobId: result.jobId,
            stdoutOffset: result.stdoutOffset,
            stderrOffset: result.stderrOffset,
          },
        };
      }

      return completeCommand(context.logger, result);
    },
    poll: async (context) => {
      const { config, state } = context;
      if (!state?.jobId) {
        throw new Error('Invalid state for polling remote JavaScript execution');
      }

      const result = await pollJob(
        toConnectorContext(config['connector-id'], context, getActionsStart),
        {
          jobId: state.jobId,
          stdoutOffset: state.stdoutOffset,
          stderrOffset: state.stderrOffset,
        },
        context.maxStepSizeBytes ?? 0
      );

      if (result.status === 'running') {
        logCommandStreams(context.logger, result);
        return {
          state: {
            jobId: state.jobId,
            stdoutOffset: result.stdoutOffset,
            stderrOffset: result.stderrOffset,
          },
        };
      }

      return completeCommand(context.logger, result);
    },
    onCancel: async (context) => {
      const state = (context as { state?: z.infer<typeof StateSchema> }).state;
      if (!state?.jobId) {
        return;
      }

      await killJob(
        toConnectorContext(context.config['connector-id'], context, getActionsStart),
        state.jobId
      );
    },
  });
