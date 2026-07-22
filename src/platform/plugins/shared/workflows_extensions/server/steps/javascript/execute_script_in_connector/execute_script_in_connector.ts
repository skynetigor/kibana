/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { PluginStartContract as ActionsPluginStartContract } from '@kbn/actions-plugin/server';
import type { KibanaRequest } from '@kbn/core-http-server/src/router/request';
import { ExecutionError } from '@kbn/workflows/server';

export async function executeScriptInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  bashScript: string;
}): Promise<string> {
  const { connectorId, request, actionsStart, bashScript } = params;

  if (!actionsStart) {
    throw new Error('Actions plugin is not available');
  }

  const actionsClient = await actionsStart.getActionsClientWithRequest(request);

  const result = await actionsClient.execute({
    actionId: connectorId,
    params: {
      subAction: 'ssh',
      subActionParams: { bashScript },
    },
  });

  if (result.status === 'error') {
    throw new ExecutionError({
      type: 'ConnectorExecutionError',
      message: result.message ?? 'Unknown error executing script in connector',
      details: {
        ...result,
      },
    });
  }
  return (result.data as { stdout: string }).stdout;
}
