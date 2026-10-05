// Notes, read as Pandoc reads them: references resolved against
// definitions anywhere in the document, contents spanning their definition.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  'defined after or before':
    'a[^1] b\n\n[^1]: The note.\n\n[^2]: First.\n\nUse[^2].',
  'undefined and repeated': 'No[^x] note, a[^1][^1], [^a b]\n\n[^1]: n',
  'several blocks':
    'a[^1]\n\n[^1]: Para one.\n\n    Para two.\n\n        code\n\nafter\n\nb[^2]\n\n[^2]:\n    Starts below.',
  'nested, unresolved': 'a[^n]\n\n[^n]: Nested[^m].\n\n[^m]: Inner.',
  'defined twice, the last wins': 'a[^1]\n\n[^1]: x\n[^1]: y',
  'inline notes': 'a^[inline *note*] b a^[x](y) a^[x]{.c} b a^[] e.g. ^[n]',
  'in lists, quotes and headings':
    '- item[^1]\n\n> q[^1]\n\n# H[^1]\n\n[^1]: n\n\n- [^2]\n\n  [^2]: in item',
  'lazy lines and lists':
    'a[^1] b[^2] c[^3]\n\n[^1]: lazy\ncontinued\n\n[^2]: - list\n    - more\n\n[^3]: b',
  'after an abbreviation': 'Mr. [^1] x\n\n[^1]: n',
  'with references': 'a [^1] [link][r]\n\n[^1]: see [r]\n\n[r]: u',
  'not definitions':
    '::: d\n[^1]: n\n:::\n\na[^1]\n\nx\n[^2]: not after a line\n\n[^2]',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: Pandoc's AST (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        withoutSpans(readMarkdown(text, { tabStop })),
        pandocAst(text, tabStop),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readMarkdown(text).blocks, 0, text.length, 'document');
  });
}

test('spans: a note spans its reference, its contents their definition', () => {
  const text = 'a[^1] b\n\n[^1]: The *note*.\n';
  const [{ c: ils }] = readMarkdown(text).blocks;
  const slice = ({ start, end }) => text.slice(start, end);
  const note = ils.find((n) => n.t === 'Note');
  assert.equal(slice(note), '[^1]');
  assert.equal(slice(note.c[0]), ' The *note*.');
});

// A note defined in a container: its contents span its definition's text,
// and map in and out of what the reader read them as.
const DEFINED_IN = {
  'a block quote': [
    '> a[^q]\n>\n> [^q]: In a *quote*,\n>     indented.\n',
    'In a *quote*',
  ],
  'a list item': ['- a[^i]\n\n  [^i]: In an *item*.\n', 'In an *item*.'],
  'a definition': [
    'Term\n:   a[^d]\n\n    [^d]: In a *definition*.\n',
    'In a *definition*.',
  ],
  'a quote in an item': ['- > a[^n]\n  >\n  > [^n]: *Nested*.\n', '*Nested*.'],
};

const notesIn = (value, out = []) => {
  if (Array.isArray(value)) for (const v of value) notesIn(v, out);
  else if (value !== null && typeof value === 'object') {
    if (value.t === 'Note') out.push(value);
    for (const v of Object.values(value)) notesIn(v, out);
  }
  return out;
};

for (const [where, [text, first]] of Object.entries(DEFINED_IN)) {
  for (const tabStop of TAB_STOPS) {
    test(`a note defined in ${where} spans its definition (tab stop ${tabStop})`, () => {
      const [note] = notesIn(readMarkdown(text, { tabStop }).blocks);
      const [para] = note.c;
      assert.ok(text.slice(para.start, para.end).includes(first));
      const { contents } = note.c;
      const from = contents.toInnerStart(para.start);
      assert.equal(contents.toOuterStart(from), para.start);
      assert.ok(contents.text.slice(from).trimStart().startsWith(first));
    });
  }
}
