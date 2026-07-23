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

const Markers = {
  exitCode: {
    start: '_____start_exit_code_____',
    end: '_____end_exit_code_____',
  },
  stdout: {
    start: '_____start_stdout_____',
    end: '_____end_stdout_____',
  },
  stderr: {
    start: '_____start_stderr_____',
    end: '_____end_stderr_____',
  },
};

export type ExecuteBashOutput =
  | {
      status: 'running';
      pid: string;
      tmpDir: string;
      stdout?: string;
      stderr?: string;
    }
  | {
      status: 'terminated';
      stdout: string | undefined;
      stderr: string | undefined;
      exitCode: number | undefined;
    };

function buildRunScript(
  bashCode: string,
  tmpDir: string,
  scriptPath: string,
  stdoutPath: string,
  stderrPath: string,
  exitCodePath: string,
  donePath: string
): string {
  const encodedScript = Buffer.from(bashCode).toString('base64');
  return `#!/bin/bash
mkdir -p "${tmpDir}"
printf '%s' '${encodedScript}' | base64 -d > "${scriptPath}"
(bash "${scriptPath}" < /dev/null > "${stdoutPath}" 2>"${stderrPath}"; echo $? > "${exitCodePath}"; touch "${donePath}") </dev/null >/dev/null 2>&1 &
PID=$!
TIMEOUT=20
COUNT=0
IN_PROGRESS=1
while [ ! -f "${donePath}" ] && [ $COUNT -lt $TIMEOUT ]; do
  sleep 0.1
  COUNT=$((COUNT + 1))
done
echo '${Markers.stderr.start}'
cat "${stderrPath}" 2>/dev/null || true
echo '${Markers.stderr.end}'
echo '${Markers.stdout.start}'
cat "${stdoutPath}" 2>/dev/null || true
echo '${Markers.stdout.end}'

if [ -f "${donePath}" ]; then
  echo '${Markers.exitCode.start}'
  cat "${exitCodePath}" 2>/dev/null || echo '0'
  echo '${Markers.exitCode.end}'
  rm -rf "${tmpDir}"
  IN_PROGRESS=0
fi

if [ $IN_PROGRESS -eq 1 ]; then
  echo "${scriptPath} is still running. PID:$PID"
fi`;
}

async function executeScriptInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  bashScript: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { connectorId, request, actionsStart, bashScript, abortSignal } = params;

  if (!actionsStart) {
    throw new Error('Actions plugin is not available');
  }

  const actionsClient = await actionsStart.getActionsClientWithRequest(request);

  const result = await actionsClient.execute({
    actionId: connectorId,
    params: {
      subAction: 'ssh',
      subActionParams: { bashScript, signal: abortSignal },
    },
    signal: abortSignal,
  });

  if (result.status === 'error') {
    throw new ExecutionError({
      type: 'ConnectorExecutionError',
      message: result.message ?? 'Unknown error executing script in connector',
      details: {
        ...result,
      },
    });
  }
  return (result.data as { stdout: string }).stdout;
}

function extractOutput(vmOutput: string): {
  stdout: string | undefined;
  stderr: string | undefined;
  exitCode: number | undefined;
} {
  const exitCodeStart = vmOutput.lastIndexOf(Markers.exitCode.start);
  const exitCodeEnd = vmOutput.lastIndexOf(Markers.exitCode.end);
  const stdoutStart = vmOutput.lastIndexOf(Markers.stdout.start);
  const stdoutEnd = vmOutput.lastIndexOf(Markers.stdout.end);
  const stderrStart = vmOutput.lastIndexOf(Markers.stderr.start);
  const stderrEnd = vmOutput.lastIndexOf(Markers.stderr.end);

  let stdout: string | undefined;
  let stderr: string | undefined;
  let exitCode: number | undefined;

  if (exitCodeStart > -1 && exitCodeEnd > -1) {
    const exitCodeStr = vmOutput
      .substring(exitCodeStart + Markers.exitCode.start.length, exitCodeEnd)
      .trim();
    exitCode = parseInt(exitCodeStr, 10) || 0;
  }

  if (stderrStart > -1 || stderrEnd > -1) {
    stderr = vmOutput.substring(stderrStart + Markers.stderr.start.length, stderrEnd).trim();
  }

  if (stdoutStart > -1 || stdoutEnd > -1) {
    stdout = vmOutput.substring(stdoutStart + Markers.stdout.start.length, stdoutEnd);
  }

  return {
    stdout,
    stderr,
    exitCode,
  };
}

function throwIfScriptFailed(stderr: string | undefined, exitCode: number | undefined): void {
  if (exitCode === undefined) {
    return;
  }

  if (exitCode !== 0) {
    throw new ExecutionError({
      type: 'ScriptExecutionError',
      message: stderr || `Script exited with code ${exitCode}`,
      details: { exitCode },
    });
  }
}

function getDirs(tmpDirId: string) {
  return {
    scriptPath: `${tmpDirId}/script.sh`,
    stdoutPath: `${tmpDirId}/stdout.txt`,
    stderrPath: `${tmpDirId}/stderr.txt`,
    exitCodePath: `${tmpDirId}/exit_code.txt`,
    donePath: `${tmpDirId}/done`,
  };
}

export async function executeBashInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  bashCode: string;
  abortSignal?: AbortSignal;
}): Promise<ExecuteBashOutput> {
  const { connectorId, request, actionsStart, bashCode, abortSignal } = params;
  const tmpDir = `/tmp/bash_${Date.now()}`;
  const { scriptPath, stdoutPath, stderrPath, exitCodePath, donePath } = getDirs(tmpDir);

  const vmOutput = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: buildRunScript(
      bashCode,
      tmpDir,
      scriptPath,
      stdoutPath,
      stderrPath,
      exitCodePath,
      donePath
    ),
    abortSignal,
  });

  const result = extractOutput(vmOutput);

  throwIfScriptFailed(result.stderr, result.exitCode);

  const pidMarker = `${scriptPath} is still running. PID:`;
  const pidIndex = vmOutput.lastIndexOf(pidMarker);

  if (pidIndex > -1) {
    const pid = vmOutput.substring(pidIndex + pidMarker.length).trim();

    return {
      status: 'running',
      pid,
      tmpDir,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  return {
    status: 'terminated',
    stderr: result.stderr,
    stdout: result.stdout,
    exitCode: result.exitCode,
  };
}

export async function tryExtractBashOutputFromConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pid: string;
  tmpDir: string;
  abortSignal?: AbortSignal;
}): Promise<ExecuteBashOutput> {
  const { connectorId, request, actionsStart, pid, tmpDir, abortSignal } = params;
  const { scriptPath, stdoutPath, stderrPath, exitCodePath, donePath } = getDirs(tmpDir);

  const vmOutput = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: `#!/bin/bash
if [ -f "${donePath}" ]; then
  echo '${Markers.exitCode.start}'
  cat "${exitCodePath}" 2>/dev/null || echo '0'
  echo '${Markers.exitCode.end}'
  echo '${Markers.stdout.start}'
  cat "${stdoutPath}" 2>/dev/null || true
  echo '${Markers.stdout.end}'
  echo '${Markers.stderr.start}'
  cat "${stderrPath}" 2>/dev/null || true
  echo '${Markers.stderr.end}'
  rm -rf "${tmpDir}"
else
  echo "${scriptPath} is still running. PID:${pid}"
fi`,
    abortSignal,
  });

  const result = extractOutput(vmOutput);

  throwIfScriptFailed(result.stderr, result.exitCode);

  const pidMarker = `${scriptPath} is still running. PID:`;
  const returnedPid = vmOutput.substring(vmOutput.lastIndexOf(pidMarker) + pidMarker.length).trim();

  if (returnedPid) {
    return {
      status: 'running',
      pid: returnedPid,
      tmpDir,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  return {
    status: 'terminated',
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function killBashProcessInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pid: string;
}): Promise<void> {
  const { connectorId, request, actionsStart, pid } = params;
  await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: `kill -9 ${pid} 2>/dev/null || true`,
  });
}
