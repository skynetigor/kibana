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

export const RemoteHostRunCommandStepTypeId = 'remoteHost.runCommand' as const;

export const REMOTE_HOST_COMMAND_TEMPLATE_MAX_CHARS = 1024 * 32; // 32 KB

export const ConfigSchema = z.object({
  'connector-id': z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(REMOTE_HOST_COMMAND_TEMPLATE_MAX_CHARS),
});

export const OutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

export type RemoteHostRunCommandStepConfigSchema = typeof ConfigSchema;
export type RemoteHostRunCommandStepInputSchema = typeof InputSchema;
export type RemoteHostRunCommandStepOutputSchema = typeof OutputSchema;

export const remoteHostRunCommandStepCommonDefinition: CommonStepDefinition<
  RemoteHostRunCommandStepInputSchema,
  RemoteHostRunCommandStepOutputSchema,
  RemoteHostRunCommandStepConfigSchema
> = {
  id: RemoteHostRunCommandStepTypeId,
  category: StepCategory.Kibana,
  // stability: 'tech_preview',
  label: i18n.translate('workflowsExtensions.remoteHostRunCommandStep.label', {
    defaultMessage: 'Run Command',
  }),
  description: i18n.translate('workflowsExtensions.remoteHostRunCommandStep.description', {
    defaultMessage: 'Execute a shell command on a remote host via SSH and return its output',
  }),
  documentation: {
    details: `# Run Command

Execute a shell command on a remote host via an SSH Host connector and return stdout, stderr, and exit code.

## Basic Usage

\`\`\`yaml
- name: check-disk
  type: remoteHost.runCommand
  config:
    connector-id: my-ssh-host-connector
  with:
    code: |
      df -h /
\`\`\`

## Inputs

- **code** (required): Shell script to execute on the remote host.

## Output

Returns an object with:
- **stdout**: Standard output from the command.
- **stderr**: Standard error from the command.
- **exitCode**: Exit code of the command.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
