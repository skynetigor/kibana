/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';

export const CloudVmConfigSchema = z
  .object({
    ip: z.string().min(1),
  })
  .strict();

export const CloudVmSecretsSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().optional(),
    sshPrivateKey: z.string().min(1),
  })
  .strict();

export const CloudVmSshParamsSchema = z.object({
  bashScript: z.string().min(1),
  signal: z.any().optional(),
});

export const CloudVmAsyncSshParamsSchema = z.object({
  bashScript: z.string().min(1),
  signal: z.any().optional(),
});

export const CLoudVmGetAsyncCommandStatusParamsSchema = z.object({
  commandId: z.string().min(1),
  signal: z.any().optional(),
});

export const CloudVmDownloadFileParamsSchema = z.object({
  remotePath: z.string().min(1),
  signal: z.any().optional(),
});

export const CloudVmUploadFileParamsSchema = z.object({
  remotePath: z.string().min(1),
  content: z.string().min(1),
  encoding: z.literal('base64'),
  signal: z.any().optional(),
});

export const CloudVmKillAsyncCommandParamsSchema = z.object({
  commandId: z.string().min(1),
  pid: z.number().optional(),
  signal: z.any().optional(),
});

export type CloudVmConfig = z.infer<typeof CloudVmConfigSchema>;
export type CloudVmSecrets = z.infer<typeof CloudVmSecretsSchema>;
export type CloudVmSshParams = z.infer<typeof CloudVmSshParamsSchema>;
export type CloudVmDownloadFileParams = z.infer<typeof CloudVmDownloadFileParamsSchema>;
export type CloudVmUploadFileParams = z.infer<typeof CloudVmUploadFileParamsSchema>;
export type CloudVmAsyncSshParams = z.infer<typeof CloudVmAsyncSshParamsSchema>;
export type CLoudVmGetAsyncCommandStatusParams = z.infer<
  typeof CLoudVmGetAsyncCommandStatusParamsSchema
>;
export type CloudVmKillAsyncCommandParams = z.infer<typeof CloudVmKillAsyncCommandParamsSchema>;
