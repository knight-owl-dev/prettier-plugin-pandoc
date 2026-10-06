// The references a read looks up and does not find: each Pandoc prints as
// text, and a definition makes Pandoc read a link, an image or a note.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';

// Each: text, what it misses (kind, form, the text it spans), and the
// definitions that resolve them.
const CASES = {
  'a full reference': ['[a][x]\n', [['link', 'full', '[a][x]']], '\n[x]: /x\n'],
  'a collapsed reference': [
    '[b][]\n',
    [['link', 'collapsed', '[b][]']],
    '\n[b]: /b\n',
  ],
  'a shortcut reference': [
    '[c]\n',
    [['link', 'shortcut', '[c]']],
    '\n[c]: /c\n',
  ],
  'an image': ['![i][y]\n', [['image', 'full', '![i][y]']], '\n[y]: /y.png\n'],
  'a note': ['Text[^n].\n', [['note', 'full', '[^n]']], '\n[^n]: A note.\n'],
  'in a list item': ['- [a][x]\n', [['link', 'full', '[a][x]']], '\n[x]: /x\n'],
  'in a quote': [
    '> Text[^n]\n',
    [['note', 'full', '[^n]']],
    '\n[^n]: A note.\n',
  ],
};

const full = (misses) => misses.filter(([, form]) => form !== 'shortcut');

for (const [name, [text, expected, definitions]] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name} (tab stop ${tabStop})`, () => {
      const got = readMarkdown(text, { tabStop }).unresolved.map((u) => [
        u.kind,
        u.form,
        text.slice(u.start, u.end),
      ]);
      assert.deepEqual(full(got), full(expected));
      const fixed = text + definitions;
      assert.notDeepEqual(pandocAst(text, tabStop), pandocAst(fixed, tabStop));
      assert.deepEqual(full(readMarkdown(fixed, { tabStop }).unresolved), []);
    });
  }
}

test('none where Pandoc resolves', () => {
  const text =
    '[ok][d], [d][], [H] and Text[^m].\n\n# H\n\n[d]: /d\n\n[^m]: A note.\n';
  assert.deepEqual(readMarkdown(text).unresolved, []);
});

test('a note in a note is none: notes are hidden there', () => {
  const text = 'Use[^m].\n\n[^m]: See[^q].\n';
  assert.deepEqual(readMarkdown(text).unresolved, []);
});

test('the list stays out of the JSON', () => {
  const doc = readMarkdown('[a][x]\n');
  assert.deepEqual(Object.keys(doc), ['pandoc-api-version', 'meta', 'blocks']);
  assert.ok(doc.unresolved.length > 0);
});
