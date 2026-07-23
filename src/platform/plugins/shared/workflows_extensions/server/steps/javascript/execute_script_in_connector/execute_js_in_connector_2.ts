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
import {
  executeBashInConnector,
  killBashProcessInConnector,
  tryExtractBashOutputFromConnector,
} from '../../bash/execute_bash_in_connector';

const ScriptMarkers = {
  output: {
    start: '____js_output_start____',
    end: '____js_output_end____',
  },
};

export type ExecuteJsOutput =
  | {
      status: 'running';
      pid: string;
      tmpDir: string;
      stderr?: string;
      stdout?: string;
    }
  | { status: 'terminated'; output: unknown; stdout?: string; stderr?: string };

function buildUserScript(jsCode: string, outputPath: string): string {
  return `(async () => {
${jsCode}
})().then((returnValue) => {
  const path = require('path');
  const fs = require('fs');
  const file = '${outputPath}';

  if (returnValue !== undefined) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(returnValue));
  }

  process.exit(0);
}).catch((error) => {
  console.error('Error executing user script:', error);
  process.exit(1);
});`;
}

function buildRunScript(jsCode: string, tmpDir: string): string {
  // Base64-encode so the script is embedded without heredocs or quoting issues.
  const encodedScript = Buffer.from(jsCode).toString('base64');
  return `#!/bin/bash
echo '${encodedScript}' | base64 -d | node
NODE_EXIT=$?

echo '${ScriptMarkers.output.start}'
cat '${tmpDir}/output.json' 2>/dev/null || echo ''
echo '${ScriptMarkers.output.end}'

exit $NODE_EXIT
`;
}

function readOutputAndLogsFromString(fullStdout: string | undefined): {
  output: unknown;
  stdout: string;
} {
  if (!fullStdout) {
    return { output: null, stdout: '' };
  }

  const outputStartMarkerIndex = fullStdout.lastIndexOf(ScriptMarkers.output.start);
  const outputEndMarkerIndex = fullStdout.lastIndexOf(ScriptMarkers.output.end);

  if (outputStartMarkerIndex > -1 && outputEndMarkerIndex > -1) {
    const output = fullStdout
      .substring(outputStartMarkerIndex + ScriptMarkers.output.start.length, outputEndMarkerIndex)
      .trim();
    const stdout = fullStdout.substring(0, outputStartMarkerIndex).trim();
    return { output: output ? JSON.parse(output) : null, stdout };
  }

  return { output: null, stdout: fullStdout.trim() };
}

export async function executeJsInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  jsCode: string;
  abortSignal?: AbortSignal;
}): Promise<ExecuteJsOutput> {
  const { connectorId, request, actionsStart, jsCode } = params;
  const tmpDir = `/tmp/tmp_${Date.now()}`;
  const outputPath = `${tmpDir}/output.json`;

  const wrappedJs = buildUserScript(jsCode, outputPath);
  const bashCode = buildRunScript(wrappedJs, tmpDir);

  const vmResult = await executeBashInConnector({
    connectorId,
    request,
    actionsStart,
    bashCode,
  });

  if (vmResult.status === 'running') {
    return vmResult;
  }
  const { output, stdout } = readOutputAndLogsFromString(vmResult.stdout);
  return {
    status: 'terminated',
    output,
    stdout,
    stderr: vmResult.stderr,
  };
}

export async function tryExtractJsOutputFromConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pid: string;
  tmpDir: string;
}): Promise<ExecuteJsOutput> {
  const { connectorId, request, actionsStart, tmpDir, pid } = params;

  const vmResult = await tryExtractBashOutputFromConnector({
    connectorId,
    request,
    actionsStart,
    pid,
    tmpDir,
  });

  if (vmResult.status === 'running') {
    return vmResult;
  }

  const { output, stdout } = readOutputAndLogsFromString(vmResult.stdout);
  return {
    status: 'terminated',
    output,
    stdout,
    stderr: vmResult.stderr,
  };
}

export async function killProcessInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  pid: string;
}): Promise<void> {
  await killBashProcessInConnector({
    connectorId: params.connectorId,
    request: params.request,
    actionsStart: params.actionsStart,
    pid: params.pid,
  });
}
