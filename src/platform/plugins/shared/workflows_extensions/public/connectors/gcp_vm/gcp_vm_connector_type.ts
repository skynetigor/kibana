/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { lazy } from 'react';
import { i18n } from '@kbn/i18n';
import type { ActionTypeModel as ConnectorTypeModel } from '@kbn/triggers-actions-ui-plugin/public';

export const CONNECTOR_ID = '.gcp-vm';

export const getConnectorType = (): ConnectorTypeModel => ({
  id: CONNECTOR_ID,
  iconClass: 'compute',
  actionTypeTitle: i18n.translate('workflowsExtensions.gcpVmConnector.actionTypeTitle', {
    defaultMessage: 'GCP VM',
  }),
  selectMessage: i18n.translate('workflowsExtensions.gcpVmConnector.selectMessage', {
    defaultMessage: 'Execute scripts on a GCP Compute Engine VM via SSH.',
  }),
  validateParams: async () => ({ errors: {} }),
  actionConnectorFields: lazy(() => import('./gcp_vm_connector_fields')),
  actionParamsFields: lazy(() => import('./gcp_vm_params')),
});
