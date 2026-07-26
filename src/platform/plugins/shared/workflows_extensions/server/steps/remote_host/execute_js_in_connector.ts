/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { PluginStartContract as ActionsPluginStartContract } from '@kbn/actions-plugin/server';
import type { KibanaRequest } from '@kbn/core/server';
import { ExecutionError } from '@kbn/workflows/server';
import { executeSubAction, killCommandInConnector } from './execute_in_connector';

export type ExecuteJsOutput =
  | {
      status: 'running';
      commandId: string;
      pid: number;
      stderr?: string;
      stdout?: string;
    }
  | { status: 'terminated'; output: unknown; stdout: string; stderr: string; exitCode: number };

function buildUserScript(jsCode: string): string {
  return `(async () => {
${jsCode}
})().then((returnValue) => {
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(process.env.COMMAND_TMP_DIR, 'output.json'), JSON.stringify(returnValue ?? null));
  process.exit(0);
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});`;
}

function buildBashScript(jsCode: string): string {
  const encodedScript = Buffer.from(jsCode).toString('base64');
  return `#!/bin/bash
printf '%s' '${encodedScript}' | openssl base64 -d -A | node
exit $?`;
}

function throwIfScriptFailed(stderr: string, exitCode: number): void {
  if (exitCode !== 0) {
    throw new ExecutionError({
      type: 'ScriptExecutionError',
      message: stderr || `Script exited with code ${exitCode}`,
      details: { exitCode },
    });
  }
}

function parseJsonOutput(content: string | undefined): unknown {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function executeJsInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  jsCode: string;
  abortSignal?: AbortSignal;
}): Promise<ExecuteJsOutput> {
  const { connectorId, request, actionsStart, jsCode, abortSignal } = params;
  const wrappedJs = buildUserScript(jsCode);
  const bashCode = buildBashScript(wrappedJs);

  const result = await executeSubAction<{
    commandId: string;
    status: 'DONE' | 'RUNNING';
    pid: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    files?: Array<{ file: string; content: string }>;
  }>({
    connectorId,
    request,
    actionsStart,
    subAction: 'execAsync',
    subActionParams: { script: bashCode },
    abortSignal,
  });

  if (result.status === 'RUNNING') {
    return {
      status: 'running',
      commandId: result.commandId,
      pid: result.pid,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  throwIfScriptFailed(result.stderr ?? '', result.exitCode ?? 0);

  const outputFile = result.files?.find((f) => f.file === 'output.json');
  return {
    status: 'terminated',
    output: parseJsonOutput(outputFile?.content),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 0,
  };
}

export async function tryExtractJsOutputFromConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  commandId: string;
  pid: number;
}): Promise<ExecuteJsOutput> {
  const { connectorId, request, actionsStart, commandId, pid } = params;

  const result = await executeSubAction<{
    commandId: string;
    status: 'DONE' | 'RUNNING';
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    files?: Array<{ file: string; content: string }>;
  }>({
    connectorId,
    request,
    actionsStart,
    subAction: 'getExecStatus',
    subActionParams: { commandId },
  });

  if (result.status === 'RUNNING') {
    return { status: 'running', commandId, pid };
  }

  throwIfScriptFailed(result.stderr ?? '', result.exitCode ?? 0);

  const outputFile = result.files?.find((f) => f.file === 'output.json');
  return {
    status: 'terminated',
    output: parseJsonOutput(outputFile?.content),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 0,
  };
}

export async function killJsProcessInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  commandId: string;
  pid: number;
}): Promise<void> {
  await killCommandInConnector(params);
}
