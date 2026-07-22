/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { WorkflowsConnectorFeatureId } from '@kbn/actions-plugin/common';
import type { SubActionConnectorType } from '@kbn/actions-plugin/server/sub_action_framework/types';
import type { GcpOperation, GcpServiceAccount } from './gcp_utils';
import { getGcpAccessToken, pollGcpOperation } from './gcp_utils';
import { GcpVmConnector } from './gcp_vm_connector';
import { GcpVmConfigSchema, GcpVmSecretsSchema } from './schemas';
import type { GcpVmConfig, GcpVmSecrets } from './schemas';

export const CONNECTOR_ID = '.gcp-vm';
export const CONNECTOR_NAME = 'GCP VM';

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
    let sa: GcpServiceAccount;
    try {
      sa = JSON.parse(secrets.saKey) as GcpServiceAccount;
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
    await pollGcpOperation(metaOp, accessToken);

    logger.info(
      `GCP VM connector: SSH key for user "${username}" registered on instance "${vmName}"`
    );
  },
});
