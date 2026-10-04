// Line blocks, read as Pandoc reads them, their spans within their parents'
// at any depth.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  lines: '| one\n| two\n\npara',
  'leading spaces': '|   indented\n| x\n|  \n| y',
  continuations: '| a\n  continued\n   more\n| b  \n  c',
  'blank lines': '| a\n|\n| b\n\n|\n|',
  'inline markup': '| *em*\n| **strong** at end  \n| a \\\n| &amp; "q"',
  'in a quote, an item and a div':
    '> | quoted\n> | lines\n\n- | in item\n  | two\n\n::: d\n| a\n:::',
  'no line block': '|no space\n\npara\n| not a block\n\n| a\nlazy',
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

test('spans: leading spaces and a continuation', () => {
  const text = '|  a\n  b\n';
  const [block] = readMarkdown(text).blocks;
  assert.equal(text.slice(block.start, block.end), '|  a\n  b');
  const [[a, join, b]] = block.c;
  assert.deepEqual([a.c, text.slice(a.start, a.end)], ['\u00a0a', ' a']);
  assert.equal(text.slice(join.start, join.end), '\n  ');
  assert.equal(text.slice(b.start, b.end), 'b');
});
