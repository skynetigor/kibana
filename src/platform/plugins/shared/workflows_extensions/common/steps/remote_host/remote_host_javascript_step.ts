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

export const RemoteHostJavascriptStepTypeId = 'remoteHost.javascript' as const;

export const REMOTE_HOST_JAVASCRIPT_TEMPLATE_MAX_CHARS = 1024 * 32; // 32 KB

export const ConfigSchema = z.object({
  'connector-id': z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(REMOTE_HOST_JAVASCRIPT_TEMPLATE_MAX_CHARS),
});

export const OutputSchema = z.unknown();

export type RemoteHostJavascriptStepConfigSchema = typeof ConfigSchema;
export type RemoteHostJavascriptStepInputSchema = typeof InputSchema;
export type RemoteHostJavascriptStepOutputSchema = typeof OutputSchema;

export const remoteHostJavascriptStepCommonDefinition: CommonStepDefinition<
  RemoteHostJavascriptStepInputSchema,
  RemoteHostJavascriptStepOutputSchema,
  RemoteHostJavascriptStepConfigSchema
> = {
  id: RemoteHostJavascriptStepTypeId,
  category: StepCategory.Kibana,
  label: i18n.translate('workflowsExtensions.remoteHostJavascriptStep.label', {
    defaultMessage: 'Run JavaScript',
  }),
  description: i18n.translate('workflowsExtensions.remoteHostJavascriptStep.description', {
    defaultMessage: 'Execute a Node.js script on a remote host via SSH and return its output',
  }),
  documentation: {
    details: `# Run JavaScript

Execute a Node.js script on a remote host via an SSH Host connector. The script's standard
output is captured and returned as the step output. If the output is valid JSON it is parsed
into an object; otherwise it is returned as a string.

## Basic Usage

\`\`\`yaml
- name: get-hostname
  type: remoteHost.javascript
  config:
    connector-id: my-ssh-host-connector
  with:
    code: |
      const os = require('os');
      console.log(os.hostname());
\`\`\`

## Structured Output

\`\`\`yaml
- name: disk-info
  type: remoteHost.javascript
  config:
    connector-id: my-ssh-host-connector
  with:
    code: |
      const { execSync } = require('child_process');
      const available = execSync("df -BG / | awk 'NR==2{print $4}'").toString().trim();
      console.log(JSON.stringify({ available }));
\`\`\`

## Inputs

- **code** (required): Node.js script to execute on the remote host.

## Output

Returns the stdout of the script. If the output is valid JSON it is parsed into an object;
otherwise it is returned as a string. Returns \`null\` when stdout is empty.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
