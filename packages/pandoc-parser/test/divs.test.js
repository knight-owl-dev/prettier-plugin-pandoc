// Fenced divs, read as Pandoc reads them, their spans within their parents'
// at any depth.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  'a class': '::: note\nText\n:::',
  attributes: '::: {#id .a k=v}\nText\n:::\n\n:::a\nx\n:::',
  'longer fences': ':::: warn ::::\npara\n::::',
  nested: '::: a\n::: b\ninner\n:::\nouter\n:::',
  unclosed: '::: a\nunclosed',
  'no class': ':::\nno attrs\n:::\n\n::: a b\nx\n:::',
  'a closer ends a paragraph': '::: a\ntext\n:::\nafter\n\n::: b\ntext  \n:::',
  'a closer ends a list item':
    '::: a\n- item\n  lazy\n:::\n\n::: b\n- item\n\n    cont\n:::',
  'in a quote and an item': '> ::: a\n> q\n> :::\n\n- ::: a\n  in item\n  :::',
  'blocks inside':
    '::: a\n# H\n\n    code\n\nTerm\n:   def\n\n1. one\n2. two\n:::\n\ntext',
  'a fence that is no closer': '::: a\n```\ncode\n:::\n```\n:::',
  'an empty div': '::: a\n\n:::',
  'a closer at eof': '::: a\ntext\n:::: \n',
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

test('spans: a div runs to its closing fence', () => {
  const text = '::: note\nText\n:::\n\nafter\n';
  const [div] = readMarkdown(text).blocks;
  assert.equal(text.slice(div.start, div.end), '::: note\nText\n:::');
});
