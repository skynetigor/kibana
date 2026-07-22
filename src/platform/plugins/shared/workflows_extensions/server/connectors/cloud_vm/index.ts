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
import { CloudVmConnector } from './cloud_vm_connector';
import { CloudVmConfigSchema, CloudVmSecretsSchema } from './schemas';
import type { CloudVmConfig, CloudVmSecrets } from './schemas';

export const CONNECTOR_ID = '.cloud-vm';
export const CONNECTOR_NAME = 'Cloud VM';

export const getCloudVmConnectorType = (): SubActionConnectorType<CloudVmConfig, CloudVmSecrets> => ({
  id: CONNECTOR_ID,
  name: CONNECTOR_NAME,
  getService: (params) => new CloudVmConnector(params),
  schema: {
    config: CloudVmConfigSchema,
    secrets: CloudVmSecretsSchema,
  },
  supportedFeatureIds: [WorkflowsConnectorFeatureId],
  minimumLicenseRequired: 'basic' as const,
});
