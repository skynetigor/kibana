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

export type ExecutePythonOutput =
  | {
      status: 'running';
      commandId: string;
      pid: number;
      stderr?: string;
      stdout?: string;
    }
  | { status: 'terminated'; output: unknown; stdout: string; stderr: string; exitCode: number };

function buildUserPythonScript(pythonCode: string): string {
  return `import json as _json
import os as _os
import sys as _sys

def _user_fn():
${pythonCode
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}

try:
    _result = _user_fn()
    _out_path = _os.path.join(_os.environ.get('COMMAND_TMP_DIR', ''), 'output.json')
    with open(_out_path, 'w') as _f:
        _json.dump(_result, _f)
except Exception as _e:
    print(str(_e), file=_sys.stderr)
    _sys.exit(1)
`;
}

function buildBashScript(pythonCode: string): string {
  const encoded = Buffer.from(pythonCode).toString('base64');
  return `#!/bin/bash
printf '%s' '${encoded}' | openssl base64 -d -A | python3 -
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

export async function executePythonInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pythonCode: string;
  abortSignal?: AbortSignal;
}): Promise<ExecutePythonOutput> {
  const { connectorId, request, actionsStart, pythonCode, abortSignal } = params;
  const wrappedPython = buildUserPythonScript(pythonCode);
  const script = buildBashScript(wrappedPython);

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
    subActionParams: { script },
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

export async function tryExtractPythonOutputFromConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  commandId: string;
  pid: number;
}): Promise<ExecutePythonOutput> {
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

export async function killPythonProcessInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  commandId: string;
  pid: number;
}): Promise<void> {
  await killCommandInConnector(params);
}
