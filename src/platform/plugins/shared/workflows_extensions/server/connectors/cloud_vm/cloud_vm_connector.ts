/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { exec } from 'child_process';
import { closeSync, existsSync, openSync, unlinkSync, writeSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { ServiceParams } from '@kbn/actions-plugin/server';
import { SubActionConnector } from '@kbn/actions-plugin/server';
import type { CloudVmConfig, CloudVmSecrets, CloudVmSshParams } from './schemas';
import { CloudVmSshParamsSchema } from './schemas';

const execPromise = promisify(exec);

export class CloudVmConnector extends SubActionConnector<CloudVmConfig, CloudVmSecrets> {
  constructor(params: ServiceParams<CloudVmConfig, CloudVmSecrets>) {
    super(params);

    this.registerSubAction({
      name: 'ssh',
      method: 'ssh',
      schema: CloudVmSshParamsSchema,
    });
  }

  protected getResponseErrorMessage(error: Error & { response?: { data?: unknown } }): string {
    return (error.response?.data as { message?: string })?.message ?? error.message;
  }

  public async ssh(params: CloudVmSshParams): Promise<{ stdout: string }> {
    const { bashScript } = params;
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

      const escapedScript = bashScript.replace(/"/g, '\\"');

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
        command = `sshpass -e ssh ${sshOpts.join(' ')} ${username}@${ip} "${escapedScript}"`;
        env = { ...process.env, SSHPASS: password };
      } else {
        sshOpts.push('-o PasswordAuthentication=no');
        command = `ssh ${sshOpts.join(' ')} ${username}@${ip} "${escapedScript}"`;
        env = process.env;
      }

      const { stdout } = await execPromise(command, { env });

      return { stdout: stdout.trim() };
    } finally {
      if (existsSync(tempKeyPath)) {
        unlinkSync(tempKeyPath);
      }
    }
  }
}
