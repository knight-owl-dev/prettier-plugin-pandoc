// Lines an inline construct holds.
//
// Once Pandoc reads a paragraph, its inlines run before any line is asked
// whether it opens a block: a construct spanning lines takes every line it
// spans (`held.js`), and a comment or tag runs past blank lines.
// The recognizer must find the blocks Pandoc's parse holds, of each kind both
// name, in order.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks, inlines } from '../src/index.js';
import { pandocKinds, recognizerKinds } from './helpers/kinds.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

const CASES = {
  'a quote past a blank line in a comment': 'a <!-- b\n\n> c --> d',
  'a heading past a blank line in a comment': 'a <!-- b\n\n# h --> d',
  'a list past blank lines in a comment': 'a <!-- b\n\n\n- x\n-->',
  'raw TeX past a blank line in a comment':
    'a <!-- b\n\n\\begin{x}\n\\end{x} -->',
  'a fence in a comment': 'a <!-- b\n```\nc\n```\n-->',
  'a fence in a code span': 'a `x\n```\ny\n```\nz`',
  'a fence in inline math': 'a $x\n```\ny\n```\nz$',
  'a quote past a blank line in a tag': 'a <span\n\n> class="x"> b',
  'a div fence in a comment': 'a <!-- b\n::: d\nc -->',
  'a line block in a comment': 'a <!-- b\n| x\n-->',
  'a table in a comment': 'x\na <!-- b\n| p |\n|---|\n-->',
  'a setext underline in a comment': 'a <!-- b\n===\n-->',
  'a second comment on the closing line':
    'a <!-- b\n\nc --> d <!-- e\n\n> f -->',
  'a construct closed on its line': 'a <!-- b --> c\n\n> q',
  'a comment never closed': 'a <!-- b\n\n> c',
  'a comment in an item, closed past it': '- i <!-- b\n\n> c --> d',
  'a comment in a quote, past a blank line': '> a <!-- b\n>\n> c --> d',
  'a term the comment opens on': 'a <!-- b\n: def\n-->',
  'an escaped comment': 'a \\<!-- b\n\n> c --> d',
  'a comment in a code span': 'a `<!--` b\n\n> c --> d',
  'a code span in an item, cut short by a list': '- see `a\n  - c\n  - d` e',
  'a code span in a definition, cut short by a list':
    'Term\n: see `a\n  - c\n  - d` e',
  'inline math in an item, holding a list': '- see $a\n  - c\n  - d$ e',
  'a comment in a command': 'a \\emph{<!--} b\n\n> q --> c',
  'a command holding a fence': 'a \\emph{x\n```\ny\n```\nz} b',
  "a link's text, holding nothing": 'a [x\n```\ny\n```\nz](u) b',
  "a link's destination, holding a fence": 'a [x](u\n```\ny\n```\nz) b',
  "math in a link's destination": 'see [x](a$b)\n```\nc\n```\nd$ e',
  'raw TeX after a code span, before one spanning lines':
    'a `b\nc` \\begin{x}\ny\n\\end{x}',
  'a block command after a code span': 'a `b\nc` \\section{x\ny} d',
  'raw TeX after a comment, before a code span spanning lines':
    'a <!-- b\n\nc --> \\begin{x}y\\end{x} `p\n# h\nq`',
  'a backslash ending a line, then a fence': 'a \\\n```\nc\n```',
  'a backslash ending an item line, then a list': '- a \\\n  - b',
  'a block command in a command argument':
    'Para \\textbf{a\n\\section{B}\nc} d',
  'an environment in a command argument':
    'Para \\emph{x\n\\begin{itemize}\n\\item a\n\\end{itemize}\ny} z',
  'an option after a braced argument, which is text':
    'Text \\foo{x}[a]\n```\nc\n```',
  'an option after a braced argument, in an item':
    '- item \\foo{x}[a]\n  - next',
  'raw TeX after a comment ends': 'a <!-- b\n\nc --> \\begin{x}y\\end{x} > q',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer finds what Pandoc does (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerKinds(`${text}\n`, tabStop),
        pandocKinds(`${text}\n`, tabStop),
      );
    });
  }
}

// A div's closer inside a comment is the comment's: the div runs on.
const DIV = '::: d\na <!-- b\n:::\nc -->\n\n> q\n:::\n';

for (const tabStop of TAB_STOPS) {
  test(`a div's closer in a comment: the div runs on (tab stop ${tabStop})`, () => {
    const [div, ...after] = JSON.parse(readPandoc(DIV, tabStop)).blocks;
    assert.equal(div.t, 'Div');
    assert.deepEqual(after, []);
    const found = blocks(DIV, { tabStop }).filter((b) => b.type === 'div');
    assert.equal(found.length, 1);
    assert.equal(found[0].close?.end, DIV.length - 1);
  });
}

// A paragraph Pandoc holds past a blank line is reported whole: its text,
// read alone, holds what Pandoc's first paragraph in the document does.
const PARAGRAPHS = {
  'a comment past a blank line': 'a <!-- b\n\n\\begin{x}\n\\end{x} --> c\nd',
  'a tag past a blank line': 'a <span\n\nclass="x"> b',
  'a comment ended by raw TeX after it':
    'a <!-- b\n\nc --> \\begin{x}y\\end{x}',
  'a comment in a quote': '> a <!-- b\n>\n> c --> d',
  'raw TeX on the next line, indented':
    'a <!-- x\n\ny --> b\n  \\begin{center}\nz\n\\end{center}',
};

function firstParagraph(json) {
  let found;
  JSON.parse(json, (_, value) => {
    if (value?.t === 'Para' || value?.t === 'Plain') found ??= value.c;
    return value;
  });
  return found;
}

for (const [name, text] of Object.entries(PARAGRAPHS)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the paragraph is reported whole (tab stop ${tabStop})`, () => {
      const source = `${text}\n`;
      const spans = blocks(source, { tabStop }).filter(
        (b) => b.type === 'paragraph',
      );
      assert.equal(spans.length, 1);
      const read = spans[0].segments
        .map((s) => source.slice(s.start, s.end))
        .join('\n');
      assert.deepEqual(
        firstParagraph(readPandoc(`${read}\n`, tabStop)),
        firstParagraph(readPandoc(source, tabStop)),
      );
    });
  }
}

// A block-level tag is no inline tag: it holds nothing.
for (const tabStop of TAB_STOPS) {
  test(`a block-level tag holds no paragraph (tab stop ${tabStop})`, () => {
    const text = 'a <p class="x\n \n# c"> b\n';
    assert.notEqual(JSON.parse(readPandoc(text, tabStop)).blocks[1].t, 'Para');
    assert.deepEqual(
      blocks(text, { tabStop }).filter((b) => b.type === 'paragraph'),
      [],
    );
  });
}

// A paragraph reported past a blank line ends before the block after it.
for (const tabStop of TAB_STOPS) {
  test(`a held paragraph ends before the next block (tab stop ${tabStop})`, () => {
    const text =
      'a <!--\n\n--> b\n```{.python .numberLines startFrom="100"}\nx\n```\n';
    const found = blocks(text, { tabStop });
    const [paragraph] = found.filter((b) => b.type === 'paragraph');
    const [code] = found.filter((b) => b.type === 'fenced-code');
    assert.ok(paragraph.end <= code.start);
  });
}

// A braced argument then an option: the option is text, so its line break
// ends the line, and a div closer there closes the div.
for (const tabStop of TAB_STOPS) {
  test(`an option after a braced argument holds no div closer (tab stop ${tabStop})`, () => {
    const text = '::: d\nText \\foo{x}[a]\n:::\n';
    const [div] = blocks(text, { tabStop }).filter((b) => b.type === 'div');
    assert.notEqual(div.close, null);
    assert.equal(JSON.parse(readPandoc(text, tabStop)).blocks[0].t, 'Div');
  });
}

// Pandoc reads a held paragraph as markdown: its inline spans are reported.
for (const text of ['Text <!-- a\n\nb --> then $x$ and \\emph{y} more.\n']) {
  test(`inline spans in ${JSON.stringify(text.slice(0, 12))} are reported`, () => {
    assert.deepEqual(
      inlines(text).map((s) => text.slice(s.start, s.end)),
      ['$x$', '\\emph{y}'],
    );
  });
}
