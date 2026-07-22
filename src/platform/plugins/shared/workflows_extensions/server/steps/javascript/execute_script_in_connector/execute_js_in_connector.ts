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
import { executeScriptInConnector } from './execute_script_in_connector';

type ExecuteJsScriptOutput =
  | { status: 'running'; pid: string; scriptPath: string; outputPath: string; logsPath: string }
  | { status: 'terminated'; output: unknown };

function buildUserScript(jsCode: string, outputPath: string): string {
  return `(async () => {
${jsCode}
})().then((returnValue) => {
  if (returnValue !== undefined) {
    require('fs').writeFileSync('${outputPath}', JSON.stringify(returnValue));
  }
  process.exit(0);
}).catch((error) => {
  console.error('Error executing user script:', error);
  process.exit(1);
});`;
}

function buildRunScript(
  jsCode: string,
  tmpDir: string,
  scriptPath: string,
  outputPath: string,
  logsPath: string
): string {
  // Base64-encode so the script is embedded without heredocs or quoting issues.
  const encodedScript = Buffer.from(jsCode).toString('base64');
  return `#!/bin/bash
mkdir -p "${tmpDir}"
printf '%s' '${encodedScript}' | base64 -d > "${scriptPath}"
node "${scriptPath}" > "${logsPath}" 2>&1 &
PID=$!
TIMEOUT=20
COUNT=0
while [ $COUNT -lt $TIMEOUT ]; do
  STATE=$(ps -p $PID -o state= 2>/dev/null | tr -d ' ')
  if [ -z "$STATE" ] || [ "$STATE" = "Z" ]; then
    wait $PID 2>/dev/null
    echo 'Begin output'
    cat "${outputPath}" 2>/dev/null || echo ''
    echo 'End output'
    rm -f "${outputPath}"
    exit 0
  fi
  sleep 0.1
  COUNT=$((COUNT + 1))
done
echo "${scriptPath} is still running. PID:$PID"`;
}

export async function executeJsInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  jsCode: string;
}): Promise<ExecuteJsScriptOutput> {
  const { connectorId, request, actionsStart, jsCode } = params;
  const tmpDir = `/tmp/tmp_${Date.now()}`;
  const scriptPath = `${tmpDir}/script.js`;
  const outputPath = `${tmpDir}/output.json`;
  const logsPath = `${tmpDir}/logs.txt`;

  const wrappedJs = buildUserScript(jsCode, outputPath);
  const bashScript = buildRunScript(wrappedJs, tmpDir, scriptPath, outputPath, logsPath);

  const vmOutput = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript,
  });

  const logs = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: `if [ -f "${logsPath}" ]; then cat "${logsPath}"; else echo "No logs found"; fi`,
  });

  const output = readOutputFromString(vmOutput);

  if (output.success) {
    return { status: 'terminated', output: output.output };
  }

  const pidMarker = `${scriptPath} is still running. PID:`;
  const pid = vmOutput.substring(vmOutput.lastIndexOf(pidMarker) + pidMarker.length).trim();

  if (!pid) {
    throw new Error(`Failed to extract PID from output: ${vmOutput}`);
  }

  return { status: 'running', pid, scriptPath, outputPath, logsPath };
}

export async function checkForTerminationInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pid: string;
}): Promise<boolean> {
  const { connectorId, request, actionsStart, pid } = params;

  const result = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: `kill -0 ${pid} 2>/dev/null && echo "running" || echo "terminated"`,
  });

  return result.trim() === 'terminated';
}

export function readOutputFromString(
  vmOutput: string
): { success: true; output: unknown } | { success: false } {
  const startMarkerIndex = vmOutput.lastIndexOf('Begin output');
  const endMarkerIndex = vmOutput.lastIndexOf('End output');

  if (startMarkerIndex === -1 || endMarkerIndex === -1) {
    return { success: false };
  }

  const outputContent = vmOutput
    .substring(startMarkerIndex + 'Begin output'.length, endMarkerIndex)
    .trim();
  return { success: true, output: outputContent ? JSON.parse(outputContent) : null };
}

export async function tryExtractOutputFromConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pid: string;
  scriptPath: string;
  outputPath: string;
}): Promise<ExecuteJsScriptOutput> {
  const { connectorId, request, actionsStart, scriptPath, outputPath, pid } = params;

  const vmOutput = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: `#!/bin/bash
if kill -0 ${pid} 2>/dev/null; then
  echo "${scriptPath} is still running. PID:${pid}"
else
  if [ -f "${outputPath}" ]; then
    echo 'Begin output'
    cat "${outputPath}"
    echo 'End output'
    rm -f "${outputPath}"
  fi
fi`,
  });

  const output = readOutputFromString(vmOutput);

  if (output.success) {
    return { status: 'terminated', output: output.output };
  }

  if (vmOutput.includes(`${scriptPath} is still running`)) {
    const logsPath = `${outputPath.substring(0, outputPath.lastIndexOf('/'))}/logs.txt`;
    return { status: 'running', pid, scriptPath, outputPath, logsPath };
  }

  throw new Error(`VM returned no output`);
}

export async function killProcessInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pid: string;
}): Promise<void> {
  const { connectorId, request, actionsStart, pid } = params;

  const response = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: `kill -9 ${pid} 2>/dev/null || true`,
  });

  console.log(`Killed process in connector. Response: ${response}`);
}
