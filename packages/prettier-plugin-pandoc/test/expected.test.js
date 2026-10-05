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

const TODO = new Set([
  'preserve/block-commands-mid-line.md',
  'preserve/code-last-line-space.md',
  'preserve/code-misreads.md',
  'preserve/code-samples.md',
  'preserve/definition-bodies.md',
  'preserve/divs.md',
  'preserve/example-lists.md',
  'preserve/heading-misreads.md',
  'preserve/held-lines.md',
  'preserve/inline-constructs.md',
  'preserve/inline-environments.md',
  'preserve/inline-math.md',
  'preserve/inline-tex.md',
  'preserve/lazy-containers.md',
  'preserve/nesting.md',
  'preserve/quote-lazy-lines.md',
  'preserve/raw-tex-interrupts.md',
  'preserve/raw-tex.md',
  'preserve/simple-tables.md',
  'preserve/stretch-div-fences.md',
  'preserve/keystone/dialog-chapter.md',
  'preserve/keystone/elements-18-shortcut-composition.md',
  'preserve/keystone/showcase-appendix-a.md',
  'preserve/keystone/showcase-chapter-2.md',
  'always/block-commands-mid-line.md',
  'always/code-last-line-space.md',
  'always/code-misreads.md',
  'always/code-samples.md',
  'always/definition-bodies.md',
  'always/divs.md',
  'always/example-lists.md',
  'always/footnotes.md',
  'always/heading-misreads.md',
  'always/held-lines.md',
  'always/inline-commands-alone.md',
  'always/inline-constructs.md',
  'always/inline-environments.md',
  'always/inline-math.md',
  'always/inline-tex.md',
  'always/lazy-containers.md',
  'always/nesting.md',
  'always/quote-lazy-lines.md',
  'always/raw-tex-interrupts.md',
  'always/raw-tex.md',
  'always/simple-tables.md',
  'always/stretch-div-fences.md',
  'always/stretch-trailing-space.md',
  'always/wrap-hazards.md',
  'always/keystone/conditionals-chapter.md',
  'always/keystone/dialog-chapter.md',
  'always/keystone/elements-11-font.md',
  'always/keystone/elements-18-shortcut-composition.md',
  'always/keystone/showcase-appendix-a.md',
  'always/keystone/showcase-chapter-2.md',
]);

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
