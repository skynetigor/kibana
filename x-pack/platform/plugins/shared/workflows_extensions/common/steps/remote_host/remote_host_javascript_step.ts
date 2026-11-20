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

export const SshNodeStepTypeId = 'ssh.node' as const;

export const REMOTE_HOST_JAVASCRIPT_TEMPLATE_MAX_CHARS = 1024 * 32; // 32 KB

export const ConfigSchema = z.object({
  'connector-id': z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(REMOTE_HOST_JAVASCRIPT_TEMPLATE_MAX_CHARS),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
  cwd: z.string().optional(),
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
  id: SshNodeStepTypeId,
  category: StepCategory.Kibana,
  stability: 'tech_preview',
  label: i18n.translate('workflowsExtensions.remoteHostJavascriptStep.label', {
    defaultMessage: 'Run JavaScript',
  }),
  description: i18n.translate('workflowsExtensions.remoteHostJavascriptStep.description', {
    defaultMessage: 'Execute a Node.js script on a remote host via SSH and return its output',
  }),
  documentation: {
    details: `# Run JavaScript

Execute a Node.js script on a remote host via an SSH connector. Return a value from the
script to set the step output (written to \`$STEP_OUTPUT\`). Standard output and stderr
are captured to logs.

## Basic Usage

\`\`\`yaml
- name: get-hostname
  type: ssh.node
  config:
    connector-id: my-ssh-connector
  with:
    code: |
      const os = require('os');
      return os.hostname();
\`\`\`

## Structured Output

\`\`\`yaml
- name: disk-info
  type: ssh.node
  config:
    connector-id: my-ssh-connector
  with:
    code: |
      const { execSync } = require('child_process');
      const available = execSync("df -BG / | awk 'NR==2{print $4}'").toString().trim();
      return { available };
\`\`\`

## Environment Variables and Working Directory

\`\`\`yaml
- name: deploy
  type: ssh.node
  config:
    connector-id: my-ssh-connector
  with:
    cwd: /opt/myapp
    env:
      DEPLOY_ENV: production
    code: |
      return process.env.DEPLOY_ENV;
\`\`\`

## Inputs

- **code** (required): Node.js script to execute on the remote host. Use \`console.log\` for log output and \`return\` a value to set the step output. Top-level \`import\` and \`await\` are supported, and \`require()\` is available.
- **env** (optional): Key-value map of environment variables exported before \`code\` runs. Keys must be valid shell identifiers.
- **cwd** (optional): Working directory for \`code\`.

## Output

Returns the value returned by the script. Objects and arrays are serialised as JSON.
Returns \`null\` when nothing is returned.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
