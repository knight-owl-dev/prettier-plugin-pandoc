// Lists inside list items.
//
// In a list item's content a list may open straight after a paragraph line,
// where elsewhere Pandoc wants a blank line first. Pandoc's parse gives its
// list items and code blocks; the recognizer must find as many of each.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

// Each list's items: a bullet list is its items, an ordered one has its
// attributes first.
const ITEMS_OF = { BulletList: (c) => c, OrderedList: (c) => c[1] };

function pandocCounts(text, tabStop) {
  const counts = { items: 0, code: 0 };
  JSON.parse(readPandoc(text, tabStop), (_, value) => {
    const items = ITEMS_OF[value?.t];
    if (items !== undefined) counts.items += items(value.c).length;
    if (value?.t === 'CodeBlock') counts.code++;
    return value;
  });
  return counts;
}

const CODE = new Set(['fenced-code', 'indented-code']);
// A fancy or example list is reported whole; its items are what Pandoc counts.
const ITEMS = new Set(['fancy-list', 'example-list']);

function recognizerCounts(text, tabStop) {
  const found = blocks(text, { tabStop });
  const lines = (block) => text.slice(block.start, block.end).split('\n');
  return {
    items: found.reduce(
      (n, b) =>
        n +
        (b.type === 'list-item' ? 1 : 0) +
        (ITEMS.has(b.type)
          ? lines(b).filter((l) => /^[ \t]*(\(?[\w#@]+[.)])/.test(l)).length
          : 0),
      0,
    ),
    code: found.filter((b) => CODE.has(b.type)).length,
  };
}

const CASES = {
  'a nested list after the first line': '- a\n  - b',
  'a nested list after two lines': '- a\n  more\n  - b',
  'a nested list after a later paragraph': '- a\n\n  para\n  - b',
  'an ordered nested list': '- a\n  1. b',
  'a list in a block quote after a line': '> a\n> - b',
  'three levels, then a fence':
    '1. one\n    - two\n        - three\n\n            ```\n            code\n            ```',
  'three levels, then indented code':
    '- one\n  - two\n    - three\n\n          code',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on items and code (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerCounts(`${text}\n`, tabStop),
        pandocCounts(`${text}\n`, tabStop),
      );
    });
  }
}
