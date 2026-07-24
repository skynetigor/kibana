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

export const ScriptsBashStepTypeId = 'code.bash' as const;

export const BASH_TEMPLATE_MAX_CHARS = 1024 * 32; // 32 KB

export const ConfigSchema = z.object({
  connectorId: z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(BASH_TEMPLATE_MAX_CHARS),
});

export const OutputSchema = z.string();

export type ScriptsBashStepConfigSchema = typeof ConfigSchema;
export type ScriptsBashStepInputSchema = typeof InputSchema;
export type ScriptsBashStepOutputSchema = typeof OutputSchema;

export const scriptsBashStepCommonDefinition: CommonStepDefinition<
  ScriptsBashStepInputSchema,
  ScriptsBashStepOutputSchema,
  ScriptsBashStepConfigSchema
> = {
  id: ScriptsBashStepTypeId,
  category: StepCategory.Kibana,
  stability: 'tech_preview',
  label: i18n.translate('workflowsExtensions.scriptsBashStep.label', {
    defaultMessage: 'Run Bash',
  }),
  description: i18n.translate('workflowsExtensions.scriptsBashStep.description', {
    defaultMessage: 'Execute a Bash script on a remote host and return its stdout',
  }),
  documentation: {
    details: `# Run Bash

Execute a Bash script on a remote host via an SSH Host connector and return its raw stdout.

## Basic Usage

\`\`\`yaml
- name: run-script
  type: code.bash
  config:
    connectorId: my-ssh-host-connector
  with:
    code: |
      echo "Hello, World"
\`\`\`

## Inputs

- **code** (required): Bash script to execute on the remote host.

## Output

Returns the combined stdout and stderr of the Bash script as a string.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
