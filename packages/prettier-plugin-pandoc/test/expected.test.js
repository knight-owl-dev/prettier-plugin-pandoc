// The output aimed at: each corpus file as the plugin formatted it before it
// printed from Pandoc's read, at width 80 and tab stop 4. Constructs gain
// formatting step by step; a snapshot not matched yet is todo.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as prettier from 'prettier';
import plugin from '../src/index.js';

const CORPUS = new URL('./corpus/', import.meta.url);
const EXPECTED = new URL('./expected/', import.meta.url);

const TODO = new Set([]);

const corpus = readdirSync(CORPUS, { recursive: true }).filter(
  (f) => f.endsWith('.md') && !f.endsWith('README.md'),
);

// Each snapshot directory's options: `tab-width-4` is where a list item's
// text aligns past its marker.
const MODES = {
  preserve: { proseWrap: 'preserve' },
  always: { proseWrap: 'always' },
  'tab-width-4': { proseWrap: 'always', tabWidth: 4 },
};

for (const [mode, modeOptions] of Object.entries(MODES)) {
  for (const name of corpus) {
    const key = `${mode}/${name}`;
    test(`${key}: formats as expected`, { todo: TODO.has(key) }, async () => {
      const text = readFileSync(new URL(name, CORPUS), 'utf8');
      const expected = readFileSync(new URL(key, EXPECTED), 'utf8');
      const options = {
        parser: 'markdown',
        plugins: [plugin],
        ...modeOptions,
        printWidth: 80,
        pandocTabStop: 4,
      };
      assert.equal(await prettier.format(text, options), expected);
    });
  }
}
