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
  'connector-id': z.string().min(1),
});

export const InputSchema = z.object({
  code: z.string().max(REMOTE_HOST_PYTHON_TEMPLATE_MAX_CHARS),
});

export const OutputSchema = z.unknown();

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
    defaultMessage: 'Execute a Python script on a remote host via SSH and return its result',
  }),
  documentation: {
    details: `# Run Python

Execute a Python script on a remote host via an SSH Host connector and return its result to downstream steps.

**Requires Python 3 to be installed on the remote host.**

## Basic Usage

\`\`\`yaml
- name: analyze
  type: remoteHost.runPython
  config:
    connector-id: my-ssh-host-connector
  with:
    code: |
      import platform
      return {"node": platform.node(), "system": platform.system()}
\`\`\`

The script runs inside a wrapper function — use \`return\` to produce the step output. The return value must be JSON-serializable (dict, list, str, int, float, bool, or None).

Use Liquid in \`with.code\` to embed workflow data before execution:

\`\`\`yaml
  - name: process
    type: remoteHost.runPython
    config:
      connector-id: my-ssh-host-connector
    with:
      code: |
        count = {{ steps.fetch.output | size }}
        return {"count": count, "label": "{{ consts.label }}"}
\`\`\`

## Requirements

- Python 3 must be installed on the remote host.
- The return value must be JSON-serializable; non-serializable types (e.g. \`datetime\`) raise an error.

## Inputs

- **code** (required): Python source code to execute on the remote host.

## Output

Returns the value produced by the \`return\` statement. The output schema is dynamic and depends on what the code returns.
`,
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
