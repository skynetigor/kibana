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
  | {
      status: 'terminated';
      output: unknown;
    };

function buildUserScript(jsCode: string, outputPath: string): string {
  const userScript = `
  (async () => {
    ${jsCode}
  })().then((returnValue) => {
    if (returnValue !== undefined) {
      require('fs').writeFileSync('${outputPath}', JSON.stringify(returnValue));
    }
  
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error executing user script:', error);
    process.exit(1);
  })
  `;
  const runNodeScript = `
  node << 'EOF'
  ${userScript}
  EOF
          `.trim();
  return runNodeScript;
}

function buildRunScript(code: string, scriptPath: string, outputPath: string, logsPath: string) {
  return `
#!/bin/bash
mkdir -p "${scriptPath}"
# Configuration
NODE_SCRIPT="${scriptPath}"  # Takes script name as 1st arg, or defaults to script.js
LOG_FILE="${logsPath}"  # Log file for stdout and stderr

# 1. Run Node script in background and redirect output
node "$NODE_SCRIPT" > "$LOG_FILE" 2>&1 &
PID=$!

# 2. Poll for completion up to 2 seconds (20 iterations x 0.1s)
TIMEOUT=20
COUNT=0

while [ $COUNT -lt $TIMEOUT ]; do
    # Check process state ('Z' = zombie/finished, empty = exited)
    STATE=$(ps -p $PID -o state= 2>/dev/null | tr -d ' ')

    if [ -z "$STATE" ] || [ "$STATE" = "Z" ]; then
        # Process terminated within 2 seconds
        wait $PID 2>/dev/null  # Reap the process
        echo 'Begin output'
        cat "${outputPath}" || echo ''
        echo 'End output'
        rm -f "${outputPath}"  # Clean up output file
        exit 0
    fi

    sleep 0.1
    COUNT=$((COUNT + 1))
done

# 3. Timeout exceeded (process is still running)
echo "${scriptPath} is still running. PID:$PID"
    `;
}

export async function executeJsInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  jsCode: string;
}): Promise<ExecuteJsScriptOutput> {
  const { connectorId, request, actionsStart, jsCode } = params;
  const tmpDirPath = `/tmp/tmp_${Date.now()}`;
  const scriptPath = `${tmpDirPath}/script.js`;
  const outputPath = `${tmpDirPath}/output.json`;
  const logsPath = `${tmpDirPath}/logs.txt`;
  const runNodeScript = buildUserScript(jsCode, outputPath);

  // Execute the script in the background and get the PID
  const vmOutput = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: buildRunScript(runNodeScript, scriptPath, outputPath, logsPath),
  });

  const logs = await executeScriptInConnector({
    connectorId,
    request,
    actionsStart,
    bashScript: `cat "${logsPath}"`,
  });

  const output = readOutputFromString(vmOutput);

  if (output?.success) {
    return {
      status: 'terminated',
      output: output.output,
    };
  }

  const pidMessage = `${scriptPath} is still running. PID:`;
  const pid = vmOutput.substring(vmOutput.lastIndexOf(pidMessage) + pidMessage.length).trim();

  if (!pid) {
    throw new Error(`Failed to extract PID from output: ${vmOutput}`);
  }

  return {
    status: 'running',
    pid,
    scriptPath,
    outputPath,
    logsPath,
  };
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
    return {
      success: false,
    };
  }

  const outputContent = vmOutput
    .substring(startMarkerIndex + 'Begin output'.length, endMarkerIndex)
    .trim();
  return {
    success: true,
    output: outputContent ? JSON.parse(outputContent) : null,
  };
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
    bashScript: `
isRunning = (kill -0 ${pid} 2>/dev/null && echo "running")

if [ "$isRunning" = "running" ]; then
  echo "${scriptPath} is still running
else
    if [ -f "${outputPath}" ]; then
        cat "${outputPath}"
    echo "${outputPath} not found"
    exit 1
`,
  });

  const output = readOutputFromString(vmOutput);

  if (output.success) {
    return {
      status: 'terminated',
      output: output.output,
    };
  }

  if (vmOutput.includes(`${scriptPath} is still running`)) {
    return {
      status: 'running',
      pid,
      scriptPath,
      outputPath,
      logsPath: `${scriptPath}/logs.txt`,
    };
  }

  throw new Error(`VM returned no output`);
}
