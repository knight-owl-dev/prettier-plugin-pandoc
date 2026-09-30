// What opens where Pandoc resumes after raw TeX.
//
// Pandoc reads blocks again straight after a raw block, mid-line or past the
// next line's indentation, so any block may open there. The recognizer must
// report the blocks Pandoc's parse holds, of each kind both name, in order.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

// Pandoc's parse as the kinds of block both sides report, in document order.
function pandocKinds(text, tabStop) {
  const kinds = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    const kind = {
      BlockQuote: 'block-quote',
      CodeBlock: 'code',
      DefinitionList: 'definition-list',
      Div: 'div',
      LineBlock: 'line-block',
      Table: 'table',
    }[node.t];
    if (kind !== undefined) kinds.push(kind);
    if (node.t === 'RawBlock' && node.c[0] === 'tex') kinds.push('raw-tex');
    // An item per list entry, as the recognizer reports them.
    if (node.t === 'BulletList') {
      for (const item of node.c) {
        kinds.push('list-item');
        walk(item);
      }
      return;
    }
    if (node.t === 'OrderedList') {
      for (const item of node.c[1]) {
        kinds.push('list-item');
        walk(item);
      }
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(readPandoc(text, tabStop)).blocks);
  return kinds;
}

const KIND = {
  'fenced-code': 'code',
  'indented-code': 'code',
  'grid-table': 'table',
  'pipe-table': 'table',
  'simple-table': 'table',
  'multiline-table': 'table',
};
const KINDS = new Set([
  'block-quote',
  'code',
  'definition-list',
  'div',
  'line-block',
  'list-item',
  'raw-tex',
  'table',
]);

function recognizerKinds(text, tabStop) {
  return blocks(text, { tabStop })
    .map((block) => KIND[block.type] ?? block.type)
    .filter((kind) => KINDS.has(kind));
}

// What may follow an environment's end on its line.
const TAILS = {
  'a block quote': '> b\n> c',
  'a lazy block quote': '> b\nc',
  'a list': '- b\n- c',
  'a list item going on': '- b\n\n  c',
  'a list item holding code': '- b\n\n    c',
  'an ordered list': '1. a\n2. b',
  'a fence': '```\ncode\n```',
  'a div': '::: d\ntext\n:::',
  'a line block': '| line\n| two',
  'a definition list': 'Term\n\n:   def',
  'a heading': '# h',
  'a rule': '---',
  'spaces then text': '      code',
};

const CASES = {
  ...Object.fromEntries(
    Object.entries(TAILS).flatMap(([name, tail]) => [
      [`${name} after an environment`, `\\begin{x}y\\end{x} ${tail}`],
      [`${name} after one in paragraph text`, `a \\begin{x}y\\end{x} ${tail}`],
    ]),
  ),
  'code a line after a command': '\\newpage\n        code',
  'a list a line after a command': '\\newpage\n    - item',
  'a block quote a line after a command': '\\newpage\n  > q',
  'a heading a line after a command': '\\newpage\n   # h',
  'a block quote in a block quote': '> \\begin{x}y\\end{x} > b',
  'a list in a list item': '- \\begin{x}y\\end{x} - b',
  'resuming twice': '\\begin{x}y\\end{x} > \\begin{z}w\\end{z} > c',
  'a table whose first cell is an environment':
    '\\begin{x}y\\end{x} | a | b |\n|---|---|\n| c | d |',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer finds what Pandoc does (tab stop ${tabStop})`, () => {
      const source = `${text}\n`;
      assert.deepEqual(
        recognizerKinds(source, tabStop),
        pandocKinds(source, tabStop),
      );
    });
  }
}
