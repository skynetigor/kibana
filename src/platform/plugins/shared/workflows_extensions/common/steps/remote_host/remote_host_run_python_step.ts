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

export const RemoteHostRunPythonStepTypeId = 'remoteHost.runPython' as const;

export const REMOTE_HOST_PYTHON_TEMPLATE_MAX_CHARS = 1024 * 32; // 32 KB

export const ConfigSchema = z.object({
  connectorId: z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(REMOTE_HOST_PYTHON_TEMPLATE_MAX_CHARS),
});

export const OutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

export type RemoteHostRunPythonStepConfigSchema = typeof ConfigSchema;
export type RemoteHostRunPythonStepInputSchema = typeof InputSchema;
export type RemoteHostRunPythonStepOutputSchema = typeof OutputSchema;

export const remoteHostRunPythonStepCommonDefinition: CommonStepDefinition<
  RemoteHostRunPythonStepInputSchema,
  RemoteHostRunPythonStepOutputSchema,
  RemoteHostRunPythonStepConfigSchema
> = {
  id: RemoteHostRunPythonStepTypeId,
  category: StepCategory.Kibana,
  stability: 'tech_preview',
  label: i18n.translate('workflowsExtensions.remoteHostRunPythonStep.label', {
    defaultMessage: 'Run Python',
  }),
  description: i18n.translate('workflowsExtensions.remoteHostRunPythonStep.description', {
    defaultMessage: 'Execute a Python script on a remote host via SSH and return its output',
  }),
  documentation: {
    details: `# Run Python

Execute a Python script on a remote host via an SSH Host connector and return stdout, stderr,
and exit code.

**Requires Python 3 to be installed on the remote host.**

## Basic Usage

\`\`\`yaml
- name: analyze
  type: remoteHost.runPython
  config:
    connectorId: my-ssh-host-connector
  with:
    code: |
      import platform
      print(platform.node())
\`\`\`

## Inputs

- **code** (required): Python source code to execute on the remote host.

## Output

Returns an object with:
- **stdout**: Standard output from the script.
- **stderr**: Standard error from the script.
- **exitCode**: Exit code of the script.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
