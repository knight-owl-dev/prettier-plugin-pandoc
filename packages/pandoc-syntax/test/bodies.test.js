// What each list item, definition and block quote holds.
//
// Pandoc reads a container's text as a document of its own. Each body the
// recognizer reports, read again as the one item of a list or as a quote,
// must hold what Pandoc's parse holds there, in order. A quote inside an item
// is read inside one too, where a list may open after a paragraph line. A tab
// left in the content would move with the item's indentation: no case keeps
// one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

// A tight list's paragraphs are plain, a loose one's not.
const plain = (json) =>
  JSON.stringify(json, (_, value) =>
    value?.t === 'Para' ? { t: 'Plain', c: value.c } : value,
  );

function pandocBodies(text, tabStop) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    if (node.t === 'BulletList') {
      for (const body of node.c) {
        found.push(plain(body));
        walk(body);
      }
      return;
    }
    if (node.t === 'BlockQuote') {
      found.push(plain(node.c));
      walk(node.c);
      return;
    }
    if (node.t === 'DefinitionList') {
      for (const [, definitions] of node.c) {
        for (const body of definitions) {
          found.push(plain(body));
          walk(body);
        }
      }
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(readPandoc(text, tabStop)).blocks);
  return found;
}

const ITEMS = new Set(['list-item', 'definition']);

// `lines` as the one item of a list, and what Pandoc reads in it.
const asItem = (lines) =>
  lines.map((line, n) => `${n === 0 ? '- ' : '  '}${line}`);
const itemOf = (blocks) => blocks[0].c[0];

function recognizerBodies(text, tabStop) {
  const found = blocks(text, { tabStop });
  const inItem = (body) =>
    found.some(
      (b) => ITEMS.has(b.type) && b.start < body.start && body.end <= b.end,
    );
  return found
    .filter((b) => ITEMS.has(b.type) || b.type === 'block-quote')
    .map((body) => {
      const lines = body.lines.map((l) => text.slice(l.start, l.end));
      const quote = body.type === 'block-quote';
      const nested = quote && inItem(body);
      let wrapped = quote ? lines.map((l) => `> ${l}`) : asItem(lines);
      if (nested) wrapped = asItem(wrapped);
      const read = JSON.parse(readPandoc(`${wrapped.join('\n')}\n`, tabStop));
      const held = nested ? itemOf(read.blocks) : read.blocks;
      return plain(quote ? held[0].c : itemOf(held));
    });
}

const CASES = {
  'a tight definition': 'Term\n:   Def',
  'a loose definition': 'Term\n\n:   Def',
  'a tilde marker': 'Term\n~   Def',
  'two definitions of one term': 'Term\n:   One\n:   Two',
  'two definitions, a blank line between': 'Term\n:   One\n\n:   Two',
  'a lazy continuation': 'Term\n:   Def line\nlazy line',
  'an indented second paragraph': 'Term\n:   Def\n\n    Second para',
  'text after a blank line': 'Term\n:   Def\n\ntext',
  'two terms': 'T1\n:   D1\n\nT2\n:   D2',
  'a narrow marker resumed at its column': 'Term\n: x\n\n  y',
  'a narrow marker resumed past its column': 'Term\n: x\n\n   y',
  'a tab after the marker': 'Term\n:\tx\n\n\ty',
  'code after a wide gap': 'Term\n\n:      code',
  'code past a blank line': 'Term\n: x\n\n      code',
  'a marker indented two spaces': 'Term\n  : x\n\n    y',
  'an empty definition then another': 'Term\n:\n:   Two',
  'raw TeX': 'Term\n\n:   \\begin{x}y\\end{x}',
  'a block quote': 'Term\n\n:   > q',
  'a fence': 'Term\n\n:   ```\n    code\n    ```',
  'a list': 'Term\n\n:   - a\n    - b',
  'a nested definition list': 'Term\n\n:   Inner\n    :   def',
  'a heading as a later term': 'A\n: a\n\n# H\n: b',
  'a list marker as a later term': 'A\n: a\n\n- x\n: b',
  'a fence as a later term': 'A\n: a\n\n```\n: b',
  'indented code as a later term': 'A\n: a\n\n    code\n: b',
  'a later term, blank lines before its marker': 'A\n: a\n\nB\n\n\n: b',
  'a div closer as a later term': '::: d\nA\n: a\n\n:::\n: b\n:::',
  'a lazy fence': 'Term\n: x\n```\ncode\n```',
  'a lazy list marker': 'Term\n: x\n- b',
  'a fence lazy past a blank line': 'Term\n: x\n\n  y\n```\ncode\n```',
  'a definition list inside a div': '::: note\nTerm\n:   Def\n:::',
  'a definition in a list item': '- item\n\n  Term\n  :   > q',
  'a fence after an item': '- a\n```\ncode\n```',
  'a tilde fence after an item': '- a\n~~~\ncode\n~~~',
  'a fence after an item past a blank line': '- a\n\n  b\n```\ncode\n```',
  'a fence after a nested item': '- a\n  - b\n```\ncode\n```',
  'a fence after an indented line': '- a\n  b\n```\ncode\n```',
  'a fence after a quote': '> x\n```\ncode\n```',
  'a fence after a quote, indented': '> x\n  ```\ncode\n```',
  'an unclosed fence after a quote': '> x\n```\nno close',
  'a fence Pandoc refuses after a quote': '> x\n```js two words\ncode\n```',
  'a tilde fence after a quote': '> x\n~~~\ncode\n~~~',
  'a fence after a quote, closed past a blank line': '> q\n```\n\na\n```\n```',
  'a list marker after a quote': '> q\n- b',
  'a list marker after a quote in an item': '- a\n\n  > q\n  - b',
  'a list marker after a quote in a definition': 'Term\n: > q\n  - b',
  'a list in a quote in an item': '- a\n\n  > q\n  > - b',
  'a list in a quote in a quote in an item': '- a\n\n  > > q\n  > - b',
  'a list in a quote in a definition': 'Term\n: > q\n  > - b',
  'a list in a quote': '> q\n> - b',
  'an indented lazy line after a quote line left blank': '> x\n>\n    lazy',
  'a quote marker past the block indent': '> x\n    > y',
  'a quote marker a code indent deeper': '> x\n        > y',
  'a quote marker after a tab': '> x\n\t> y',
  'a fence Pandoc refuses after an item': '- a\n```js two words\nc\n```',
  'a fence Pandoc refuses after a definition': 'T\n: a\n```{.x} y\nc\n```',
  'a raw attribute fence after an item': '- a\n```{=html}\n<b>\n```',
  'a fence after a refused one': '- a\n  b\n  ```{.x} y\n```\ncode\n```',
  'a three-space gap': '-   x',
  'a six-space gap, then a line past a blank': '-      x\n\n     y',
  'a tab after a bullet': '-\tx\n\n\ty',
  'a tab after an indented bullet': ' -\tx\n\n    y',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: each body holds what Pandoc's does (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerBodies(`${text}\n`, tabStop),
        pandocBodies(`${text}\n`, tabStop),
      );
    });
  }
}
