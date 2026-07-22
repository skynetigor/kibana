/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { exec } from 'child_process';
import { generateKeyPairSync } from 'crypto';
import { closeSync, existsSync, openSync, unlinkSync, writeSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { ServiceParams } from '@kbn/actions-plugin/server';
import { SubActionConnector } from '@kbn/actions-plugin/server';
import type { GcpOperation, GcpServiceAccount, MetadataItem } from './gcp_utils';
import { getGcpAccessToken, pollGcpOperation } from './gcp_utils';
import type { GcpVmConfig, GcpVmSecrets, GcpVmSshParams } from './schemas';
import { GcpVmSshParamsSchema } from './schemas';

const execPromise = promisify(exec);

interface VmData {
  networkInterfaces: Array<{ accessConfigs: Array<{ natIP?: string }> }>;
  metadata: { fingerprint: string; items?: MetadataItem[] };
}

interface ProjectData {
  commonInstanceMetadata?: { items?: MetadataItem[] };
}

export class GcpVmConnector extends SubActionConnector<GcpVmConfig, GcpVmSecrets> {
  constructor(params: ServiceParams<GcpVmConfig, GcpVmSecrets>) {
    super(params);

    this.registerSubAction({
      name: 'ssh',
      method: 'ssh',
      schema: GcpVmSshParamsSchema,
    });
  }

  protected getResponseErrorMessage(error: Error & { response?: { data?: unknown } }): string {
    return (error.response?.data as { message?: string })?.message ?? error.message;
  }

  public async ssh(params: GcpVmSshParams): Promise<{ stdout: string }> {
    const { bashScript } = params;
    const { projectId, zone, vmName, username } = this.config;
    const tempKeyPath = join(tmpdir(), `gcp_ssh_${Date.now()}`);

    try {
      // 1. Parse service account JSON and authenticate with GCP
      let sa: GcpServiceAccount;
      try {
        sa = JSON.parse(this.secrets.saKey) as GcpServiceAccount;
      } catch {
        throw new Error('saKey must be valid service account JSON');
      }
      const accessToken = await getGcpAccessToken(sa);

      // 2. Generate ephemeral RSA key pair
      // Node.js does not support 'openssh' encoding; build the SSH wire format from JWK components.
      const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const { n, e } = keyPair.publicKey.export({ format: 'jwk' }) as { n: string; e: string };
      const sshLen = (b: Buffer) => {
        const l = Buffer.alloc(4);
        l.writeUInt32BE(b.length, 0);
        return Buffer.concat([l, b]);
      };
      // SSH MPI is two's-complement: prepend 0x00 when the high bit is set to keep the value positive
      const toSshMpi = (b: Buffer) => (b[0] >= 0x80 ? Buffer.concat([Buffer.from([0x00]), b]) : b);
      const publicKey = `ssh-rsa ${Buffer.concat([
        sshLen(Buffer.from('ssh-rsa')),
        sshLen(toSshMpi(Buffer.from(e, 'base64url'))),
        sshLen(toSshMpi(Buffer.from(n, 'base64url'))),
      ]).toString('base64')}`;

      // Private key in traditional RSA PKCS1 PEM — universally accepted by all SSH clients
      const privateKey = keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

      // Write private key to temp file with restricted permissions (no writeFileSync — ESLint restricted)
      const fd = openSync(tempKeyPath, 'w', 0o600);
      writeSync(fd, privateKey);
      closeSync(fd);

      // 3. Fetch VM info
      const vmUrl = `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances/${vmName}`;
      const vmRes = await fetch(vmUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const vmData = (await vmRes.json()) as VmData;
      if (!vmRes.ok) throw new Error(`Failed to fetch VM: ${JSON.stringify(vmData)}`);

      // Check instance-level OS Login — overrides metadata SSH keys when enabled
      const instanceOsLogin = vmData.metadata.items
        ?.find((i) => i.key === 'enable-oslogin')
        ?.value.toLowerCase();

      // Check project-level OS Login — applies when instance does not explicitly override it
      const projectRes = await fetch(
        `https://compute.googleapis.com/compute/v1/projects/${projectId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const projectData = (await projectRes.json()) as ProjectData;
      const projectOsLogin = projectData.commonInstanceMetadata?.items
        ?.find((i) => i.key === 'enable-oslogin')
        ?.value.toLowerCase();

      const osLoginActive =
        instanceOsLogin === 'true' || (projectOsLogin === 'true' && instanceOsLogin !== 'false');
      if (osLoginActive) {
        throw new Error(
          'OS Login is enabled — metadata SSH keys are ignored. ' +
            `Disable it: gcloud compute instances add-metadata ${vmName} --zone=${zone} --metadata=enable-oslogin=FALSE`
        );
      }

      const publicIp = vmData.networkInterfaces[0]?.accessConfigs[0]?.natIP;
      if (!publicIp) throw new Error('VM does not have an external IP address.');
      const { fingerprint } = vmData.metadata;

      // 4. Push ephemeral public key to VM metadata
      const sshKeyLine = `${username}:${publicKey.trim()} ${username}`;
      const items: MetadataItem[] = vmData.metadata.items ?? [];
      const existingIndex = items.findIndex((i) => i.key === 'ssh-keys');
      if (existingIndex > -1) {
        items[existingIndex].value += `\n${sshKeyLine}`;
      } else {
        items.push({ key: 'ssh-keys', value: sshKeyLine });
      }

      const metaRes = await fetch(`${vmUrl}/setMetadata`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint, items }),
      });
      const metaOp = (await metaRes.json()) as GcpOperation;
      if (!metaRes.ok || metaOp.error) {
        throw new Error(`Failed to update VM metadata: ${JSON.stringify(metaOp)}`);
      }

      // setMetadata is a long-running GCP operation — poll until DONE before SSHing
      await pollGcpOperation(metaOp, accessToken);

      // 5. Execute the script over SSH, retrying until the Guest Agent propagates the key
      // The agent polls metadata every ~30 s so a fixed wait is unreliable; retry with backoff.
      const escapedScript = bashScript.replace(/"/g, '\\"');
      const sshCommand = `ssh -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${username}@${publicIp} "${escapedScript}"`;

      const maxAttempts = 12; // up to 60 s total (12 × 5 s)
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise((res) => setTimeout(res, 5000));
        try {
          const { stdout } = await execPromise(sshCommand);
          return { stdout: stdout.trim() };
        } catch (err) {
          lastError = err as Error;
        }
      }

      throw lastError ?? new Error(`SSH failed after ${maxAttempts} attempts`);
    } finally {
      if (existsSync(tempKeyPath)) {
        unlinkSync(tempKeyPath);
      }
    }
  }
}
