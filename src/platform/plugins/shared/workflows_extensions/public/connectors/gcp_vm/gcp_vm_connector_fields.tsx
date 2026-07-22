/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import type {
  ActionConnectorFieldsProps,
  ConfigFieldSchema,
  SecretsFieldSchema,
} from '@kbn/triggers-actions-ui-plugin/public';
import { SimpleConnectorForm } from '@kbn/triggers-actions-ui-plugin/public';

const configFormSchema: ConfigFieldSchema[] = [
  { id: 'projectId', label: 'Project ID', isRequired: true },
  { id: 'zone', label: 'Zone', isRequired: true },
  { id: 'vmName', label: 'VM Name', isRequired: true },
  { id: 'username', label: 'SSH Username', isRequired: true },
  { id: 'sshKey', label: 'SSH Public Key', isRequired: true },
];

const secretsFormSchema: SecretsFieldSchema[] = [
  { id: 'saKey', label: 'Service Account JSON Key', isRequired: true },
];

const GcpVmConnectorFields: React.FunctionComponent<ActionConnectorFieldsProps> = ({
  readOnly,
  isEdit,
}) => (
  <SimpleConnectorForm
    isEdit={isEdit}
    readOnly={readOnly}
    configFormSchema={configFormSchema}
    secretsFormSchema={secretsFormSchema}
  />
);

// eslint-disable-next-line import/no-default-export
export { GcpVmConnectorFields as default };
