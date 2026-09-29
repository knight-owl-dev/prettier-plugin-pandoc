// Constructs inside containers, checked against Pandoc rather than asserted.
//
// Each construct is wrapped in a block quote, a list item and both, and the
// recognizer must find in it what Pandoc does: the same constructs, in the same
// order, and each span's lines must hold the construct's own text — no
// container prefix in them.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { blocks } from '../src/index.js';

// Pandoc's parse as the kinds of construct it holds, in document order.
function pandocKinds(text) {
  const run = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], {
    input: text,
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
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
  walk(JSON.parse(run.stdout).blocks);
  return kinds;
}

const TABLES = new Set(['grid-table', 'simple-table', 'multiline-table']);
const KINDS = new Set([
  'div',
  'line-block',
  'definition-list',
  'block-quote',
  'raw-tex',
]);

function recognizerKinds(text) {
  return blocks(text)
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
  'a list item in a block quote': (lines) =>
    ['- item', '', ...lines.map((l) => `  ${l}`)].map((l) =>
      `> ${l}`.trimEnd(),
    ),
};

for (const [what, construct] of Object.entries(CONSTRUCTS)) {
  for (const [where, wrap] of Object.entries(WRAPPERS)) {
    const text = `${wrap(construct.split('\n')).join('\n')}\n`;

    test(`${what} in ${where}: the recognizer and Pandoc agree`, () => {
      assert.deepEqual(
        recognizerKinds(text).filter((k) => k !== 'list-item'),
        pandocKinds(text),
      );
    });

    test(`${what} in ${where}: no span holds a container prefix`, () => {
      for (const block of blocks(text)) {
        if (block.type === 'block-quote' || block.type === 'list-item') {
          continue;
        }
        const spans =
          block.type === 'div'
            ? [block.open, block.close].filter((s) => s !== null)
            : block.segments;
        for (const span of spans) {
          assert.doesNotMatch(text.slice(span.start, span.end), /^(>| {2})/);
        }
      }
    });
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
  test(`${name}: the recognizer and Pandoc agree`, () => {
    assert.deepEqual(
      recognizerKinds(`${text}\n`).filter((k) => k !== 'list-item'),
      pandocKinds(`${text}\n`),
    );
  });
}
