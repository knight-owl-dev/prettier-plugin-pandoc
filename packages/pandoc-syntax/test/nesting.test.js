// Constructs inside containers.
//
// Each construct is wrapped in a block quote, a list item and both, and the
// recognizer must find in it what Pandoc does: the same constructs, in the same
// order, and each span's lines must hold the construct's own text — no
// container prefix in them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

// Pandoc's parse as the kinds of construct it holds, in document order.
function pandocKinds(text, tabStop) {
  const stdout = readPandoc(text, tabStop);
  const kinds = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    const kind = {
      Div: 'div',
      LineBlock: 'line-block',
      DefinitionList: 'definition-list',
      BlockQuote: 'block-quote',
    }[node.t];
    if (kind !== undefined) kinds.push(kind);
    if (node.t === 'RawBlock' && node.c[0] === 'tex') kinds.push('raw-tex');
    if (node.t === 'Table') kinds.push('table');
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(stdout).blocks);
  return kinds;
}

const TABLES = new Set(['grid-table', 'simple-table', 'multiline-table']);
// A container's own segments are its whole lines, prefix and all.
const CONTAINERS = new Set(['block-quote', 'list-item', 'footnote-definition']);
const KINDS = new Set([
  'div',
  'line-block',
  'definition-list',
  'block-quote',
  'raw-tex',
]);

function recognizerKinds(text, tabStop) {
  return blocks(text, { tabStop })
    .map((block) => (TABLES.has(block.type) ? 'table' : block.type))
    .filter((kind) => KINDS.has(kind) || kind === 'table');
}

const CONSTRUCTS = {
  'a div': '::: note\ntext\n:::',
  'a raw TeX environment': '\\begin{center}\nx y\n\\end{center}',
  'a line block': '| a\n| b',
  'a grid table': '+---+---+\n| a | b |\n+===+===+\n| 1 | 2 |\n+---+---+',
  'a definition list': 'Term\n:   Def',
  'nested divs': '::: outer\n::: inner\ntext\n:::\n:::',
};

const WRAPPERS = {
  'a block quote': (lines) => lines.map((l) => `> ${l}`.trimEnd()),
  'a list item': (lines) => ['- item', '', ...lines.map((l) => `  ${l}`)],
  'a footnote definition': (lines) => [
    'a[^n]',
    '',
    '[^n]: first',
    '',
    ...lines.map((l) => `    ${l}`),
  ],
  'a list item in a block quote': (lines) =>
    ['- item', '', ...lines.map((l) => `  ${l}`)].map((l) =>
      `> ${l}`.trimEnd(),
    ),
};

for (const [what, construct] of Object.entries(CONSTRUCTS)) {
  for (const [where, wrap] of Object.entries(WRAPPERS)) {
    const text = `${wrap(construct.split('\n')).join('\n')}\n`;

    for (const tabStop of TAB_STOPS) {
      const label = `${what} in ${where} (tab stop ${tabStop})`;

      test(`${label}: the recognizer and Pandoc agree`, () => {
        assert.deepEqual(
          recognizerKinds(text, tabStop).filter((k) => k !== 'list-item'),
          pandocKinds(text, tabStop),
        );
      });

      test(`${label}: no span holds a container prefix`, () => {
        const found = blocks(text, { tabStop });
        const contentStarts = found
          .filter((block) => CONTAINERS.has(block.type))
          .flatMap((container) => container.lines.map((line) => line.start));
        for (const block of found) {
          if (CONTAINERS.has(block.type)) continue;
          const spans =
            block.type === 'div'
              ? [block.open, block.close].filter((s) => s !== null)
              : block.segments;
          for (const span of spans) {
            // The innermost container's content on this span's line starts at
            // the latest content start there.
            const lineStart = text.lastIndexOf('\n', span.start - 1) + 1;
            const onLine = contentStarts.filter(
              (s) => s >= lineStart && s <= span.end,
            );
            if (onLine.length > 0) {
              assert.ok(
                span.start >= Math.max(...onLine),
                text.slice(span.start, span.end),
              );
            }
          }
        }
      });
    }
  }
}

// Pandoc collects a container's text before parsing it, so an unprefixed line
// straight after one belongs to it whatever the line before it was.
const LAZY = {
  'a fence closing a quote lazily': '> ```\ncode\n```',
  'a heading then a lazy line': '> # H\nlazy',
  'a div continued lazily': '> ::: note\ntext\n:::',
  'raw TeX continued lazily': '> \\begin{center}\nx\n\\end{center}',
  'a fence closing a list item unindented': '- a\n\n  ```\n  x\n```\n  y',
  'a lazy list line': '- a\n::: note\ntext\n:::',
  'a div closing straight after a list':
    '::: dialog\n\n- one\n- two\n:::\n\nafter',
  'a div closing straight after a quote': '::: note\n> quoted\n:::\n\nafter',
};

for (const [name, text] of Object.entries(LAZY)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerKinds(`${text}\n`, tabStop).filter((k) => k !== 'list-item'),
        pandocKinds(`${text}\n`, tabStop),
      );
    });
  }
}
