// `--version`, as the README describes it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PANDOC_RELEASE } from '@knight-owl-llc/pandoc-parser/upstream';
import manifest from '../package.json' with { type: 'json' };

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const VERSION = `pandoc-lint ${manifest.version}\npandoc ${PANDOC_RELEASE}\n`;

test('--version: its version, then the Pandoc release it follows', () => {
  const run = (...args) =>
    execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(run('--version'), VERSION);
  assert.equal(run('--tab-stop=0', '--version', 'unread.md'), VERSION);
});
