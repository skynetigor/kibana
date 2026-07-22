/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createSign } from 'crypto';
import { WorkflowsConnectorFeatureId } from '@kbn/actions-plugin/common';
import type { SubActionConnectorType } from '@kbn/actions-plugin/server/sub_action_framework/types';
import { GcpVmConnector } from './gcp_vm_connector';
import { GcpVmConfigSchema, GcpVmSecretsSchema } from './schemas';
import type { GcpVmConfig, GcpVmSecrets } from './schemas';

export const CONNECTOR_ID = '.gcp-vm';
export const CONNECTOR_NAME = 'GCP VM';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface GcpOperation {
  status: 'PENDING' | 'RUNNING' | 'DONE';
  selfLink: string;
  error?: { errors: Array<{ code: string; message: string }> };
}

// --- Helpers (same JWT/OAuth pattern as vm.ts) ---

function base64UrlEncode(str: string | Buffer): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getGcpAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
  const claimSet = JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  });

  const signatureInput = `${base64UrlEncode(header)}.${base64UrlEncode(claimSet)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signatureInput);
  const signature = signer.sign(sa.private_key);
  const jwt = `${signatureInput}.${base64UrlEncode(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = (await response.json()) as { access_token: string };
  if (!response.ok) throw new Error(`GCP auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// --- Connector type factory ---

export const getGcpVmConnectorType = (): SubActionConnectorType<GcpVmConfig, GcpVmSecrets> => ({
  id: CONNECTOR_ID,
  name: CONNECTOR_NAME,
  getService: (params) => new GcpVmConnector(params),
  schema: {
    config: GcpVmConfigSchema,
    secrets: GcpVmSecretsSchema,
  },
  supportedFeatureIds: [WorkflowsConnectorFeatureId],
  minimumLicenseRequired: 'basic' as const,

  // On first installation: push the user-supplied public SSH key to the VM metadata
  // so they can SSH in without generating ephemeral key pairs.
  preSaveHook: async ({ config, secrets, logger, isUpdate }) => {
    if (isUpdate) return;

    const { projectId, zone, vmName, username, sshKey } = config;

    // 1. Parse and authenticate with the service account key
    let sa: ServiceAccount;
    try {
      sa = JSON.parse(secrets.saKey) as ServiceAccount;
    } catch {
      throw new Error('saKey must be valid service account JSON');
    }

    const accessToken = await getGcpAccessToken(sa);

    // 2. Fetch current VM metadata to obtain the fingerprint and existing items
    const vmUrl = `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances/${vmName}`;
    const vmRes = await fetch(vmUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const vmData = (await vmRes.json()) as {
      metadata: { fingerprint: string; items?: Array<{ key: string; value: string }> };
    };
    if (!vmRes.ok) throw new Error(`Failed to fetch VM "${vmName}": ${JSON.stringify(vmData)}`);

    // 3. Append the SSH key to the ssh-keys metadata entry
    const items = vmData.metadata.items ?? [];
    const sshKeyLine = `${username}:${sshKey.trim()} ${username}`;
    const existingIdx = items.findIndex((i) => i.key === 'ssh-keys');
    if (existingIdx > -1) {
      items[existingIdx].value += `\n${sshKeyLine}`;
    } else {
      items.push({ key: 'ssh-keys', value: sshKeyLine });
    }

    // 4. Write the updated metadata back
    const metaRes = await fetch(`${vmUrl}/setMetadata`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fingerprint: vmData.metadata.fingerprint, items }),
    });
    const metaOp = (await metaRes.json()) as GcpOperation;
    if (!metaRes.ok || metaOp.error) {
      throw new Error(`Failed to set VM metadata: ${JSON.stringify(metaOp)}`);
    }

    // 5. Poll the GCP operation until it completes
    let op = metaOp;
    while (op.status !== 'DONE') {
      await new Promise((res) => setTimeout(res, 2000));
      const opRes = await fetch(op.selfLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      op = (await opRes.json()) as GcpOperation;
      if (op.error) throw new Error(`Metadata operation failed: ${JSON.stringify(op.error)}`);
    }

    logger.info(
      `GCP VM connector: SSH key for user "${username}" registered on instance "${vmName}"`
    );
  },
});
