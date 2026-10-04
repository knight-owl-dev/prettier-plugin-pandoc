// Headings, thematic breaks and code blocks, read as Pandoc reads them.

// cspell:disable

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'ATX headings':
    '# One\n\n## Two ##\n\n### Three ###   \n\n###### Six\n\n####### Seven',
  'ATX headings without a blank line': '# One\ntext\n## Two\n# Three',
  'a hash without a space': '#hashtag and #1',
  'an empty ATX heading': '#\n\n## \n',
  'ATX heading attributes': '# A {#id .c k=v}\n\n## B {-}\n\n# C # {.x}',
  'setext headings': 'One\n===\n\nTwo\n---\n\nThree {#t}\n=====',
  'a setext heading after a paragraph line': 'para\nTitle\n=====',
  'heading identifiers': [
    '# Hello, *World*!',
    '# Hello, World!',
    '# 1. Numbered',
    '# Ünïcödé `code` "q"',
    '# !!!',
    '# Σίσυφος ΣΣ',
    '# a_b-c.d',
  ].join('\n\n'),
  'explicit and automatic identifiers': '# x {#x}\n\n# x\n\n# x-1\n\n# x',
  'thematic breaks': '***\n\n- - -\n\n_ _ _ _\n\n  * * *\n\npara\n\n***\npara',
  'backtick fences': '```\ncode\n```\n\n````\nwith ``` inside\n````',
  'tilde fences': '~~~ python\nx = 1\n~~~\n\n~~~~{.c #i k=v}\ny\n~~~~~~',
  'fence languages': '```C++\na\n```\n\n``` objective-c {.x}\nb\n```',
  'raw blocks': '```{=html}\n<b>x</b>\n```\n\n~~~ {=latex}\n\\x\n~~~',
  'indented fences': '  ```\n  code\n    more\n  ```',
  'an unclosed fence': '```\nno close\n\ntext',
  'a fence after a paragraph line': 'para\n```\ncode\n```',
  // A tilde fence after a paragraph line is text, which subscript reads:
  // not ported yet.
  'indented code': '    code\n    more\n\n        deeper\n\n    after a blank',
  'indented code after a paragraph': 'para\n\n    code\n\ntext',
  'a fence closing with text after it': '```\na\n``` x\n```',
  'languages named like object properties':
    '```toString\na\n```\n\n```constructor\nb\n```\n\n```__proto__\nc\n```',
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
}

// Each block and the source it spans.
const blockSpans = (text) =>
  readMarkdown(text).blocks.map((b) => [b.t, text.slice(b.start, b.end)]);

test('spans: headings, breaks and code blocks, their trailing blank lines out', () => {
  assert.deepEqual(
    blockSpans('# A {#a}\n\nB\n=\n\n***\n\n```py\nx\n```\n\n    y\n\nz'),
    [
      ['Header', '# A {#a}'],
      ['Header', 'B\n='],
      ['HorizontalRule', '***'],
      ['CodeBlock', '```py\nx\n```'],
      ['CodeBlock', '    y'],
      ['Para', 'z'],
    ],
  );
});

test('spans: a block runs to the end of its last line', () => {
  assert.deepEqual(
    blockSpans('x\n===   \n\n```\ny\n```   \n\n***  \n\n# z  \n\n# w {#w}  '),
    [
      ['Header', 'x\n===   '],
      ['CodeBlock', '```\ny\n```   '],
      ['HorizontalRule', '***  '],
      ['Header', '# z  '],
      ['Header', '# w {#w}  '],
    ],
  );
});
