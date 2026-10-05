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

for (const proseWrap of ['preserve', 'always']) {
  for (const name of corpus) {
    const key = `${proseWrap}/${name}`;
    test(`${key}: formats as expected`, { todo: TODO.has(key) }, async () => {
      const text = readFileSync(new URL(name, CORPUS), 'utf8');
      const expected = readFileSync(new URL(key, EXPECTED), 'utf8');
      const options = {
        parser: 'markdown',
        plugins: [plugin],
        proseWrap,
        printWidth: 80,
        pandocTabStop: 4,
      };
      assert.equal(await prettier.format(text, options), expected);
    });
  }
}
