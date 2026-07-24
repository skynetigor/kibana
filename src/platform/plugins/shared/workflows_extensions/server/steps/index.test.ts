/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { loggerMock } from '@kbn/logging-mocks';
import { registerInternalStepDefinitions } from '.';
import { ScriptsJavaScriptStepTypeId } from '../../common/steps/javascript';
import {
  RemoteHostRunCommandStepTypeId,
  RemoteHostRunJavascriptStepTypeId,
  RemoteHostRunPythonStepTypeId,
  RemoteHostUploadFileStepTypeId,
  RemoteHostDownloadFileStepTypeId,
} from '../../common/steps/remote_host';
import { ServerStepRegistry } from '../step_registry';

describe('registerInternalStepDefinitions', () => {
  it('does not register code.javascript when javaScriptStep is disabled', () => {
    const registry = new ServerStepRegistry(loggerMock.create());

    registerInternalStepDefinitions(registry, {
      experimentalSteps: { javaScriptStep: false, remoteHostSteps: false },
    });

    expect(registry.has(ScriptsJavaScriptStepTypeId)).toBe(false);
  });

  it('registers code.javascript when javaScriptStep is enabled', () => {
    const registry = new ServerStepRegistry(loggerMock.create());

    registerInternalStepDefinitions(registry, {
      experimentalSteps: { javaScriptStep: true, remoteHostSteps: false },
    });

    expect(registry.has(ScriptsJavaScriptStepTypeId)).toBe(true);
  });

  it('does not register remoteHost steps when remoteHostSteps is disabled', () => {
    const registry = new ServerStepRegistry(loggerMock.create());

    registerInternalStepDefinitions(registry, {
      experimentalSteps: { javaScriptStep: false, remoteHostSteps: false },
    });

    expect(registry.has(RemoteHostRunCommandStepTypeId)).toBe(false);
    expect(registry.has(RemoteHostRunJavascriptStepTypeId)).toBe(false);
    expect(registry.has(RemoteHostRunPythonStepTypeId)).toBe(false);
    expect(registry.has(RemoteHostUploadFileStepTypeId)).toBe(false);
    expect(registry.has(RemoteHostDownloadFileStepTypeId)).toBe(false);
  });

  it('registers all remoteHost steps when remoteHostSteps is enabled', () => {
    const registry = new ServerStepRegistry(loggerMock.create());

    registerInternalStepDefinitions(registry, {
      experimentalSteps: { javaScriptStep: false, remoteHostSteps: true },
    });

    expect(registry.has(RemoteHostRunCommandStepTypeId)).toBe(true);
    expect(registry.has(RemoteHostRunJavascriptStepTypeId)).toBe(true);
    expect(registry.has(RemoteHostRunPythonStepTypeId)).toBe(true);
    expect(registry.has(RemoteHostUploadFileStepTypeId)).toBe(true);
    expect(registry.has(RemoteHostDownloadFileStepTypeId)).toBe(true);
  });
});
