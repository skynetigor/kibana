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

export const RemoteHostRunJavascriptStepTypeId = 'remoteHost.runJavascript' as const;

export const REMOTE_HOST_JS_TEMPLATE_MAX_CHARS = 1024 * 32; // 32 KB

export const ConfigSchema = z.object({
  connectorId: z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(REMOTE_HOST_JS_TEMPLATE_MAX_CHARS),
});

export const OutputSchema = z.unknown();

export type RemoteHostRunJavascriptStepConfigSchema = typeof ConfigSchema;
export type RemoteHostRunJavascriptStepInputSchema = typeof InputSchema;
export type RemoteHostRunJavascriptStepOutputSchema = typeof OutputSchema;

export const remoteHostRunJavascriptStepCommonDefinition: CommonStepDefinition<
  RemoteHostRunJavascriptStepInputSchema,
  RemoteHostRunJavascriptStepOutputSchema,
  RemoteHostRunJavascriptStepConfigSchema
> = {
  id: RemoteHostRunJavascriptStepTypeId,
  category: StepCategory.Kibana,
  stability: 'tech_preview',
  label: i18n.translate('workflowsExtensions.remoteHostRunJavascriptStep.label', {
    defaultMessage: 'Run JavaScript',
  }),
  description: i18n.translate('workflowsExtensions.remoteHostRunJavascriptStep.description', {
    defaultMessage: 'Execute a Node.js script on a remote host via SSH and return its result',
  }),
  documentation: {
    details: `# Run JavaScript (Remote Host)

Execute a Node.js script on a remote host via an SSH Host connector. The return value of the
script becomes the step output and is available to downstream steps.

**Requires Node.js to be installed on the remote host.**

## Basic Usage

\`\`\`yaml
- name: compute
  type: remoteHost.runJavascript
  config:
    connectorId: my-ssh-host-connector
  with:
    code: |
      const os = require('os');
      return { hostname: os.hostname(), cpus: os.cpus().length };
\`\`\`

## Inputs

- **code** (required): Node.js source code. The value returned by the script becomes the output.

## Output

Returns the value produced by the script. The output schema is dynamic and depends on what the
script returns.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
