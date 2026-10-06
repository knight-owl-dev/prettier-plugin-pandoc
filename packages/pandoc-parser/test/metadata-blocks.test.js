// Where a read's metadata comes from: each block Pandoc reads metadata
// from, and none it does not. Deleting a block it reports changes Pandoc's
// metadata.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';

// Each: text, and its blocks as kind and text.
const CASES = {
  'a YAML block': [
    '---\ntitle: A\n---\n\nText\n',
    [['yaml', '---\ntitle: A\n---']],
  ],
  'two, one closed by dots': [
    '---\na: 1\n---\n\nText\n\n---\nb: 2\n...\n',
    [
      ['yaml', '---\na: 1\n---'],
      ['yaml', '---\nb: 2\n...'],
    ],
  ],
  'a title block': [
    '% Title\n% Author\n\nText\n',
    [['title', '% Title\n% Author']],
  ],
  'in a quote': ['> ---\n> c: 1\n> ---\n', [['yaml', '---\n> c: 1\n> ---']]],
  'a rule': ['Text\n\n---\n\nmore\n', []],
  'no mapping': ['---\n- a\n---\n', []],
};

for (const [name, [text, expected]] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name} (tab stop ${tabStop})`, () => {
      const found = readMarkdown(text, { tabStop }).metadataBlocks;
      assert.deepEqual(
        found.map((m) => [m.kind, text.slice(m.start, m.end)]),
        expected,
      );
      for (const { start, end } of found) {
        const without = text.slice(0, start) + text.slice(end);
        const meta = (t) => pandocAst(t, tabStop).meta;
        assert.notDeepEqual(meta(without), meta(text));
      }
    });
  }
}
