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

export interface PeeledImports {
  imports: string;
  body: string;
}

const isImportStart = (trimmed: string): boolean =>
  /^import(?:\s|['"{*]|$)/.test(trimmed) &&
  !/^import\s*\./.test(trimmed) &&
  !/^import\s*\(/.test(trimmed);

const isGap = (trimmed: string): boolean => trimmed === '' || trimmed.startsWith('//');

const braceDelta = (line: string): number => {
  let delta = 0;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '{') delta++;
    else if (char === '}') delta--;
  }
  return delta;
};

const nextStatementIsImport = (lines: string[], from: number): boolean => {
  const trimmed = lines
    .slice(from)
    .map((line) => line.trim())
    .find((line) => !isGap(line));
  return trimmed !== undefined && isImportStart(trimmed);
};

/**
 * Takes import statements off the front of a script. Blank lines and line
 * comments in that prefix stay with the imports. The first other statement
 * ends the peel; the rest of the file is the body.
 */
export const peelLeadingImports = (code: string): PeeledImports => {
  const lines = code.split('\n');
  const header: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (isGap(trimmed)) {
      if (!nextStatementIsImport(lines, index + 1)) break;
      header.push(lines[index]);
      index++;
    } else if (isImportStart(trimmed)) {
      let depth = 0;
      do {
        depth += braceDelta(lines[index]);
        header.push(lines[index]);
        index++;
      } while (index < lines.length && depth > 0);
    } else {
      break;
    }
  }

  return {
    imports: header.join('\n'),
    body: lines.slice(index).join('\n'),
  };
};
