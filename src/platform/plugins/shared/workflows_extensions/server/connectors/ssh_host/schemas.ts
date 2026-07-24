/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';

export const SshHostConfigSchema = z
  .object({
    ip: z.string().min(1),
  })
  .strict();

export const SshHostSecretsSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().optional(),
    sshPrivateKey: z.string().min(1),
  })
  .strict();

export const SshHostSshParamsSchema = z.object({
  bashScript: z.string().min(1),
  signal: z.any().optional(),
});

export const SshHostAsyncSshParamsSchema = z.object({
  bashScript: z.string().min(1),
  signal: z.any().optional(),
});

export const SshHostGetAsyncCommandStatusParamsSchema = z.object({
  commandId: z.string().min(1),
  signal: z.any().optional(),
});

export const SshHostDownloadFileParamsSchema = z.object({
  remotePath: z.string().min(1),
  signal: z.any().optional(),
});

export const SshHostUploadFileParamsSchema = z.object({
  remotePath: z.string().min(1),
  content: z.string().min(1),
  encoding: z.literal('base64'),
  signal: z.any().optional(),
});

export const SshHostKillAsyncCommandParamsSchema = z.object({
  commandId: z.string().min(1),
  pid: z.number().optional(),
  signal: z.any().optional(),
});

export type SshHostConfig = z.infer<typeof SshHostConfigSchema>;
export type SshHostSecrets = z.infer<typeof SshHostSecretsSchema>;
export type SshHostSshParams = z.infer<typeof SshHostSshParamsSchema>;
export type SshHostDownloadFileParams = z.infer<typeof SshHostDownloadFileParamsSchema>;
export type SshHostUploadFileParams = z.infer<typeof SshHostUploadFileParamsSchema>;
export type SshHostAsyncSshParams = z.infer<typeof SshHostAsyncSshParamsSchema>;
export type SshHostGetAsyncCommandStatusParams = z.infer<
  typeof SshHostGetAsyncCommandStatusParamsSchema
>;
export type SshHostKillAsyncCommandParams = z.infer<typeof SshHostKillAsyncCommandParamsSchema>;
