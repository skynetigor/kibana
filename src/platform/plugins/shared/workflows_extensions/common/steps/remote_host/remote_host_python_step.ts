/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import { StepCategory } from '@kbn/workflows';
import { z } from '@kbn/zod/v4';
import type { CommonStepDefinition } from '../../step_registry/types';

export const RemoteHostPythonStepTypeId = 'remoteHost.python' as const;

export const REMOTE_HOST_PYTHON_TEMPLATE_MAX_CHARS = 1024 * 32; // 32 KB

export const ConfigSchema = z.object({
  'connector-id': z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(REMOTE_HOST_PYTHON_TEMPLATE_MAX_CHARS),
});

export const OutputSchema = z.unknown();

export type RemoteHostPythonStepConfigSchema = typeof ConfigSchema;
export type RemoteHostPythonStepInputSchema = typeof InputSchema;
export type RemoteHostPythonStepOutputSchema = typeof OutputSchema;

export const remoteHostPythonStepCommonDefinition: CommonStepDefinition<
  RemoteHostPythonStepInputSchema,
  RemoteHostPythonStepOutputSchema,
  RemoteHostPythonStepConfigSchema
> = {
  id: RemoteHostPythonStepTypeId,
  category: StepCategory.Kibana,
  label: i18n.translate('workflowsExtensions.remoteHostPythonStep.label', {
    defaultMessage: 'Run Python',
  }),
  description: i18n.translate('workflowsExtensions.remoteHostPythonStep.description', {
    defaultMessage: 'Execute a Python script on a remote host via SSH and return its output',
  }),
  documentation: {
    details: `# Run Python

Execute a Python 3 script on a remote host via an SSH Host connector. The script's standard
output is captured and returned as the step output. If the output is valid JSON it is parsed
into an object; otherwise it is returned as a string.

## Basic Usage

\`\`\`yaml
- name: get-hostname
  type: remoteHost.python
  config:
    connector-id: my-ssh-host-connector
  with:
    code: |
      import socket
      print(socket.getfqdn())
\`\`\`

## Structured Output

\`\`\`yaml
- name: disk-info
  type: remoteHost.python
  config:
    connector-id: my-ssh-host-connector
  with:
    code: |
      import shutil, json
      total, used, free = shutil.disk_usage('/')
      print(json.dumps({'available_gb': free // (1024 ** 3)}))
\`\`\`

## Inputs

- **code** (required): Python 3 script to execute on the remote host.

## Output

Returns the stdout of the script. If the output is valid JSON it is parsed into an object;
otherwise it is returned as a string. Returns \`null\` when stdout is empty.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
