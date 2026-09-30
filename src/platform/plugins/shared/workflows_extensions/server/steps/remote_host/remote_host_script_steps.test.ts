/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v 1".
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { hostname, tmpdir } from 'os';
import { join } from 'path';
import { buildRemoteHostJavascriptScript } from './remote_host_javascript_step';
import { wrapUserScript } from './remote_host_job';
import { buildRemoteHostPythonScript } from './remote_host_python_step';

const runWrapped = (script: string): { code: number; output: string; stderr: string } => {
  const workdir = mkdtempSync(join(tmpdir(), 'wf-script-'));
  let code = 0;
  let stderr = '';
  try {
    execFileSync('bash', ['-lc', 'cat > "$WORKDIR/script.sh" && bash "$WORKDIR/script.sh"'], {
      input: wrapUserScript(script, false),
      env: { ...process.env, WORKDIR: workdir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failed = error as { status?: number; stderr?: Buffer };
    code = failed.status ?? 1;
    stderr = failed.stderr?.toString('utf8') ?? '';
  }

  return {
    code,
    output: readFileSync(join(workdir, 'output.txt'), 'utf8'),
    stderr,
  };
};

describe('remote host script wrappers', () => {
  it('runs a javascript import and returns its value', () => {
    const result = runWrapped(
      buildRemoteHostJavascriptScript(`import os from 'node:os';\nreturn os.hostname();`)
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.output)).toBe(hostname());
  });

  it('keeps require() working inside the javascript wrapper', () => {
    const result = runWrapped(
      buildRemoteHostJavascriptScript(`return require('node:os').hostname();`)
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.output)).toBe(hostname());
  });

  it('runs top-level await in python and returns its value', () => {
    const result = runWrapped(
      buildRemoteHostPythonScript(`import asyncio\nawait asyncio.sleep(0)\nreturn 7`)
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.output).toBe('7');
  });
});
