// The oracle: formatting must not change what Pandoc reads.
//
// Each corpus file is formatted, and Pandoc parses it before and after. The
// two parses must match, soft breaks read as spaces — where a line wraps is the
// one thing formatting may change. Pandoc is the reader under test, so the
// suite needs it on PATH; the test image carries a pinned one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as prettier from 'prettier';
import plugin from '../src/index.js';

const CORPUS = new URL('./corpus/', import.meta.url);

// Constructs the plugin does not handle yet. Each runs, reported as todo, so
// the day one starts passing is visible in the output.
const TODO = new Set(['code-trailing-space.md:off', 'strong-emphasis.md']);

const BASE = {
  parser: 'markdown',
  plugins: [plugin],
  proseWrap: 'always',
};

// Block rules do not depend on width, and the sweep is what shows it: a narrow
// width wraps the most, so it lands the most words at the start of a line.
const WIDTHS = [40, 80, 120];

// Both ways a fenced sample can be printed: reformatted by its tag, or left to
// the markdown printer, which strips its trailing whitespace.
const EMBEDDED = ['auto', 'off'];

function pandoc(text) {
  const run = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], {
    input: text,
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  return JSON.parse(run.stdout, (_, value) =>
    value?.t === 'SoftBreak' ? { t: 'Space' } : value,
  );
}

for (const name of readdirSync(CORPUS).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(new URL(name, CORPUS), 'utf8');

  for (const [printWidth, embedded] of WIDTHS.flatMap((width) =>
    EMBEDDED.map((setting) => [width, setting]),
  )) {
    const options = {
      ...BASE,
      printWidth,
      embeddedLanguageFormatting: embedded,
    };
    const label = `${name} (width ${printWidth}, embedded ${embedded})`;
    const todo = TODO.has(name) || TODO.has(`${name}:${embedded}`);

    test(`${label}: Pandoc reads the formatted file as the source`, {
      todo,
    }, async () => {
      const formatted = await prettier.format(text, options);
      assert.deepEqual(pandoc(formatted), pandoc(text));
    });

    test(`${label}: formatting twice changes nothing`, { todo }, async () => {
      const once = await prettier.format(text, options);
      assert.equal(await prettier.format(once, options), once);
    });
  }
}
