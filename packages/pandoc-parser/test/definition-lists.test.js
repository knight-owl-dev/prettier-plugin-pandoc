// Definition lists, read as Pandoc reads them, their spans within their
// parents' at any depth.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  'tight and loose': 'Term\n:   Def\n\nLoose\n\n:   Def',
  'a tilde marker': 'Term\n~   Def',
  'several definitions and terms': 'Term\n:   One\n:   Two\n\nT2\n:   D2',
  'blocks in a definition':
    'Term *em*\n\n:   Def para\n\n    second para\n\n        code',
  'a list in a definition': 'Term\n:   - a\n    - b',
  'in a quote and an item': '> Term\n> :   Def\n\n- Term\n\n  :   Def',
  'a lazy line': 'Term\n:   lazy\ncontinuation',
  'empty definitions': 'Term\n:\n\nT\n:\n:   Two',
  'a term after a paragraph line': 'prose\nTerm\n:   Def',
  'a heading over a marker': '# Heading\n:   Def',
  'a task box in a definition': 'Term\n\n:   [ ] task',
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

test('spans: a term and its definition', () => {
  const text = 'A *term*\n:   its definition\n';
  const [list] = readMarkdown(text).blocks;
  assert.equal(
    text.slice(list.start, list.end),
    'A *term*\n:   its definition',
  );
  const [[term, [[definition]]]] = list.c;
  assert.equal(text.slice(term[2].start, term[2].end), '*term*');
  assert.equal(text.slice(definition.start, definition.end), 'its definition');
});
