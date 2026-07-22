/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ServiceParams } from '@kbn/actions-plugin/server';
import { SubActionConnector } from '@kbn/actions-plugin/server';
import type { AxiosError } from 'axios';
import type { GcpVmConfig, GcpVmSecrets, GcpVmSshParams } from './schemas';
import { GcpVmSshParamsSchema } from './schemas';

export class GcpVmConnector extends SubActionConnector<GcpVmConfig, GcpVmSecrets> {
  constructor(params: ServiceParams<GcpVmConfig, GcpVmSecrets>) {
    super(params);

    this.registerSubAction({
      name: 'ssh',
      method: 'ssh',
      schema: GcpVmSshParamsSchema,
    });
  }

  protected getResponseErrorMessage(error: AxiosError): string {
    return (error.response?.data as { message?: string })?.message ?? error.message;
  }

  // TODO: implement SSH command execution against the configured VM
  public async ssh(_params: GcpVmSshParams): Promise<void> {
    
  }
}
