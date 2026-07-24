/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { exec } from 'child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { ServiceParams } from '@kbn/actions-plugin/server';
import { SubActionConnector } from '@kbn/actions-plugin/server';
import type {
  CloudVmConfig,
  CloudVmDownloadFileParams,
  CloudVmSecrets,
  CloudVmSshParams,
  CloudVmUploadFileParams,
} from './schemas';
import {
  CloudVmDownloadFileParamsSchema,
  CloudVmSshParamsSchema,
  CloudVmUploadFileParamsSchema,
} from './schemas';

const execPromise = promisify(exec);

export class CloudVmConnector extends SubActionConnector<CloudVmConfig, CloudVmSecrets> {
  constructor(params: ServiceParams<CloudVmConfig, CloudVmSecrets>) {
    super(params);

    this.registerSubAction({
      name: 'ssh',
      method: 'ssh',
      schema: CloudVmSshParamsSchema,
    });

    this.registerSubAction({
      name: 'downloadFile',
      method: 'downloadFile',
      schema: CloudVmDownloadFileParamsSchema,
    });

    this.registerSubAction({
      name: 'uploadFile',
      method: 'uploadFile',
      schema: CloudVmUploadFileParamsSchema,
    });
  }

  protected getResponseErrorMessage(error: Error & { response?: { data?: unknown } }): string {
    return (error.response?.data as { message?: string })?.message ?? error.message;
  }

  public async ssh(params: CloudVmSshParams): Promise<{ stdout: string }> {
    const { bashScript, signal } = params;
    const { ip } = this.config;
    const { username, password, sshPrivateKey } = this.secrets;
    const tempKeyPath = join(tmpdir(), `cloud_vm_ssh_${Date.now()}`);

    try {
      // Strip \r so CRLF-pasted keys don't corrupt OpenSSH parsing; ensure trailing newline.
      const keyContent = `${sshPrivateKey.replace(/\r/g, '').trimEnd()}\n`;

      // Write private key with restricted permissions (writeFileSync is ESLint-restricted)
      const fd = openSync(tempKeyPath, 'w', 0o600);
      writeSync(fd, keyContent);
      closeSync(fd);

      // Base64-encode the script so bash variables ($PID, $STATE, etc.) are not expanded
      // by the local shell when it processes the double-quoted SSH argument.
      const encodedScript = Buffer.from(bashScript).toString('base64');
      const remoteCmd = `printf '%s' '${encodedScript}' | base64 -d | bash`;

      const sshOpts = [
        `-i "${tempKeyPath}"`,
        '-o StrictHostKeyChecking=no',
        '-o UserKnownHostsFile=/dev/null',
        '-o ConnectTimeout=10',
      ];

      let command: string;
      let env: NodeJS.ProcessEnv;

      if (password) {
        // Pass password via SSHPASS env var — safer than -p flag which is visible in ps
        // sshpass -e uses the SSHPASS variable; -o PasswordAuthentication=yes allows fallback
        sshOpts.push('-o PasswordAuthentication=yes');
        command = `sshpass -e ssh ${sshOpts.join(' ')} ${username}@${ip} "${remoteCmd}"`;
        env = { ...process.env, SSHPASS: password };
      } else {
        sshOpts.push('-o PasswordAuthentication=no');
        command = `ssh ${sshOpts.join(' ')} ${username}@${ip} "${remoteCmd}"`;
        env = process.env;
      }

      const { stdout } = await execPromise(command, { env, signal });

      return { stdout: stdout.trim() };
    } finally {
      if (existsSync(tempKeyPath)) {
        unlinkSync(tempKeyPath);
      }
    }
  }

  public async downloadFile(
    params: CloudVmDownloadFileParams
  ): Promise<{ content: string; encoding: 'base64' }> {
    const { remotePath } = params;
    const { ip } = this.config;
    const { username, password, sshPrivateKey } = this.secrets;
    const tempKeyPath = join(tmpdir(), `cloud_vm_ssh_${Date.now()}`);
    const tempDownloadPath = join(tmpdir(), `cloud_vm_download_${Date.now()}`);

    try {
      const keyContent = `${sshPrivateKey.replace(/\r/g, '').trimEnd()}\n`;
      const fd = openSync(tempKeyPath, 'w', 0o600);
      writeSync(fd, keyContent);
      closeSync(fd);

      const scpOpts = [
        `-i "${tempKeyPath}"`,
        '-o StrictHostKeyChecking=no',
        '-o UserKnownHostsFile=/dev/null',
        '-o ConnectTimeout=10',
      ];

      let command: string;
      let env: NodeJS.ProcessEnv;

      if (password) {
        scpOpts.push('-o PasswordAuthentication=yes');
        command = `sshpass -e scp ${scpOpts.join(
          ' '
        )} ${username}@${ip}:"${remotePath}" "${tempDownloadPath}"`;
        env = { ...process.env, SSHPASS: password };
      } else {
        scpOpts.push('-o PasswordAuthentication=no');
        command = `scp ${scpOpts.join(
          ' '
        )} ${username}@${ip}:"${remotePath}" "${tempDownloadPath}"`;
        env = process.env;
      }

      await execPromise(command, { env });

      const content = readFileSync(tempDownloadPath).toString('base64');
      return { content, encoding: 'base64' };
    } finally {
      if (existsSync(tempKeyPath)) {
        unlinkSync(tempKeyPath);
      }
      if (existsSync(tempDownloadPath)) {
        unlinkSync(tempDownloadPath);
      }
    }
  }

  public async uploadFile(params: CloudVmUploadFileParams): Promise<void> {
    const { remotePath, content } = params;
    const { ip } = this.config;
    const { username, password, sshPrivateKey } = this.secrets;
    const tempKeyPath = join(tmpdir(), `cloud_vm_ssh_${Date.now()}`);
    const tempUploadPath = join(tmpdir(), `cloud_vm_upload_${Date.now()}`);

    try {
      const keyContent = `${sshPrivateKey.replace(/\r/g, '').trimEnd()}\n`;
      const keyFd = openSync(tempKeyPath, 'w', 0o600);
      writeSync(keyFd, keyContent);
      closeSync(keyFd);

      const uploadFd = openSync(tempUploadPath, 'w', 0o600);
      writeSync(uploadFd, Buffer.from(content, 'base64'));
      closeSync(uploadFd);

      const scpOpts = [
        `-i "${tempKeyPath}"`,
        '-o StrictHostKeyChecking=no',
        '-o UserKnownHostsFile=/dev/null',
        '-o ConnectTimeout=10',
      ];

      let command: string;
      let env: NodeJS.ProcessEnv;

      if (password) {
        scpOpts.push('-o PasswordAuthentication=yes');
        command = `sshpass -e scp ${scpOpts.join(
          ' '
        )} "${tempUploadPath}" ${username}@${ip}:"${remotePath}"`;
        env = { ...process.env, SSHPASS: password };
      } else {
        scpOpts.push('-o PasswordAuthentication=no');
        command = `scp ${scpOpts.join(' ')} "${tempUploadPath}" ${username}@${ip}:"${remotePath}"`;
        env = process.env;
      }

      await execPromise(command, { env });
    } finally {
      if (existsSync(tempKeyPath)) {
        unlinkSync(tempKeyPath);
      }
      if (existsSync(tempUploadPath)) {
        unlinkSync(tempUploadPath);
      }
    }
  }
}
