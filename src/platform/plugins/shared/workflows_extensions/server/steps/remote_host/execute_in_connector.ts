/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { PluginStartContract as ActionsPluginStartContract } from '@kbn/actions-plugin/server';
import type { KibanaRequest } from '@kbn/core/server';
import { ExecutionError } from '@kbn/workflows/server';

export type RemoteCommandOutput =
  | {
      status: 'running';
      commandId: string;
      pid: number;
      stdout?: string;
      stderr?: string;
    }
  | {
      status: 'terminated';
      stdout: string;
      stderr: string;
      exitCode: number;
    };

export async function executeSubAction<T>(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  subAction: string;
  subActionParams: Record<string, unknown>;
  abortSignal?: AbortSignal;
}): Promise<T> {
  const { connectorId, request, actionsStart, subAction, subActionParams, abortSignal } = params;

  if (!actionsStart) {
    throw new Error('Actions plugin is not available');
  }

  const actionsClient = await actionsStart.getActionsClientWithRequest(request);

  const result = await actionsClient.execute({
    actionId: connectorId,
    params: { subAction, subActionParams },
    signal: abortSignal,
  });

  if (result.status === 'error') {
    throw new ExecutionError({
      type: 'ConnectorExecutionError',
      message: result.message ?? 'Unknown error executing sub-action in connector',
      details: { ...result },
    });
  }

  return result.data as T;
}

export async function executeCommandInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  script: string;
  abortSignal?: AbortSignal;
}): Promise<RemoteCommandOutput> {
  const { connectorId, request, actionsStart, script, abortSignal } = params;

  const result = await executeSubAction<{
    commandId: string;
    status: 'DONE' | 'RUNNING';
    pid: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }>({
    connectorId,
    request,
    actionsStart,
    subAction: 'execAsync',
    subActionParams: { script },
    abortSignal,
  });

  if (result.status === 'DONE') {
    return {
      status: 'terminated',
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
    };
  }

  return {
    status: 'running',
    commandId: result.commandId,
    pid: result.pid,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function tryExtractCommandOutputFromConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  commandId: string;
  pid: number;
  abortSignal?: AbortSignal;
}): Promise<RemoteCommandOutput> {
  const { connectorId, request, actionsStart, commandId, pid, abortSignal } = params;

  const result = await executeSubAction<{
    commandId: string;
    status: 'DONE' | 'RUNNING';
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }>({
    connectorId,
    request,
    actionsStart,
    subAction: 'getExecStatus',
    subActionParams: { commandId },
    abortSignal,
  });

  if (result.status === 'DONE') {
    return {
      status: 'terminated',
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
    };
  }

  return { status: 'running', commandId, pid };
}

export async function killCommandInConnector(params: {
  connectorId: string;
  request: KibanaRequest<unknown, unknown, unknown>;
  actionsStart: ActionsPluginStartContract | undefined;
  commandId: string;
  pid: number;
}): Promise<void> {
  const { connectorId, request, actionsStart, commandId, pid } = params;
  await executeSubAction({
    connectorId,
    request,
    actionsStart,
    subAction: 'killExec',
    subActionParams: { commandId, pid },
  });
}
