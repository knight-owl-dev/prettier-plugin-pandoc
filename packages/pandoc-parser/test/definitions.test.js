// The reference definitions a read exposes: each part's span in the source,
// in a container as at the top level, and none for a definition Pandoc
// does not read.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown } from '../src/index.js';
import { TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'every part': [
    '[a]: http://a.com "A title" {.c}\n\nUse [a].',
    [['[a]:', 'http://a.com', '"A title"', '{.c}']],
  ],
  'parts on lines of their own': [
    '[b]:\n   <http://b.com>\n   (paren title)\n\n[b]',
    [['[b]:', '<http://b.com>', '(paren title)', null]],
  ],
  'a URL alone, and two definitions': [
    "[x]: /x\n[y]: /y 'single'\n",
    [
      ['[x]:', '/x', null, null],
      ['[y]:', '/y', "'single'", null],
    ],
  ],
  'in a block quote': ['> [q]: /q\n> q[q]\n', [['[q]:', '/q', null, null]]],
  'in a list item': ['- [i]: /i "t"\n\n  [i]\n', [['[i]:', '/i', '"t"', null]]],
  'none in a code block': ['        [c]: /c\n', []],
};

for (const [name, [text, expected]] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name} (tab stop ${tabStop})`, () => {
      const slice = (span) => (span === null ? null : text.slice(...span));
      const { definitions } = readMarkdown(text, { tabStop });
      const parts = definitions.map((d) =>
        [d.label, d.url, d.title, d.attributes].map(slice),
      );
      assert.deepEqual(parts, expected);
      for (const d of definitions) {
        assert.equal(
          text.slice(d.start, d.end).startsWith(slice(d.label)),
          true,
        );
        assert.equal(d.end, (d.attributes ?? d.title ?? d.url)[1]);
      }
    });
  }
}

test('definitions stay out of the JSON', () => {
  const doc = readMarkdown('[a]: /a\n');
  assert.deepEqual(Object.keys(doc), ['pandoc-api-version', 'meta', 'blocks']);
  assert.equal(doc.definitions.length, 1);
});
