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

export const CONNECTOR_ID = '.cloud-vm';

export const getConnectorType = (): ConnectorTypeModel => ({
  id: CONNECTOR_ID,
  iconClass: 'compute',
  actionTypeTitle: i18n.translate('workflowsExtensions.cloudVmConnector.actionTypeTitle', {
    defaultMessage: 'Cloud VM',
  }),
  selectMessage: i18n.translate('workflowsExtensions.cloudVmConnector.selectMessage', {
    defaultMessage: 'Execute scripts on a cloud VM via SSH.',
  }),
  validateParams: async (actionParams) => {
    const errors: Record<string, string[]> = {};
    if (!actionParams?.subActionParams?.bashScript?.trim()) {
      errors.bashScript = [
        i18n.translate('workflowsExtensions.cloudVmConnector.params.bashScript.requiredError', {
          defaultMessage: 'Bash script is required.',
        }),
      ];
    }
    return { errors };
  },
  actionConnectorFields: lazy(() => import('./cloud_vm_connector_fields')),
  actionParamsFields: lazy(() => import('./cloud_vm_params')),
});
