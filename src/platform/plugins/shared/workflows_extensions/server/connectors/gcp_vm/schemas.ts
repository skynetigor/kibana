/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';

export const GcpVmConfigSchema = z
  .object({
    projectId: z.string().min(1),
    zone: z.string().min(1),
    vmName: z.string().min(1),
    username: z.string().min(1),
    sshKey: z.string().min(1),
  })
  .strict();

// The service account JSON key is sensitive and stored encrypted
export const GcpVmSecretsSchema = z
  .object({
    saKey: z.string().min(1),
  })
  .strict();

// Placeholder schema for the `ssh` sub-action — params TBD
export const GcpVmSshParamsSchema = z.object({}).strict();

export type GcpVmConfig = z.infer<typeof GcpVmConfigSchema>;
export type GcpVmSecrets = z.infer<typeof GcpVmSecretsSchema>;
export type GcpVmSshParams = z.infer<typeof GcpVmSshParamsSchema>;
