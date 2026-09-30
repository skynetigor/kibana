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

import { peelLeadingImports } from './peel_leading_imports';

describe('peelLeadingImports', () => {
  it('peels a leading import and leaves the return in the body', () => {
    const { imports, body } = peelLeadingImports(
      `import os from 'node:os';\nreturn os.hostname();`
    );

    expect(imports).toBe(`import os from 'node:os';`);
    expect(body).toBe('return os.hostname();');
  });

  it('peels a multiline import', () => {
    const { imports, body } = peelLeadingImports(
      `import {\n  hostname,\n} from 'node:os';\nreturn hostname();`
    );

    expect(imports).toBe(`import {\n  hostname,\n} from 'node:os';`);
    expect(body).toBe('return hostname();');
  });

  it('peels imports separated by a blank line', () => {
    const { imports, body } = peelLeadingImports(
      `import os from 'node:os';\n\nimport { readFileSync } from 'node:fs';\nreturn readFileSync;`
    );

    expect(imports).toContain(`import os from 'node:os';`);
    expect(imports).toContain(`import { readFileSync } from 'node:fs';`);
    expect(body).toBe('return readFileSync;');
  });

  it('stops at the first statement that is not an import', () => {
    const code = `const loaded = import('node:os');\nimport os from 'node:os';\nreturn loaded;`;
    const { imports, body } = peelLeadingImports(code);

    expect(imports).toBe('');
    expect(body).toBe(code);
  });
});
