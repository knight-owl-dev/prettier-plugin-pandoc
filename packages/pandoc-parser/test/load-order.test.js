// Every module loads first without the others: the reader's modules import
// each other, and none may read an import before that module has run.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

const modules = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modules(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });

for (const path of modules(SRC)) {
  test(`${relative(SRC, path)} loads first`, () => {
    const run = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(path)});`],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
  });
}
