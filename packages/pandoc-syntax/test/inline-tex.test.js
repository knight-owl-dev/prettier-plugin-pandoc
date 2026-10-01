// Where inline raw TeX is.
//
// Pandoc's parse keeps each piece of raw TeX's text: inline, or a block an
// environment written mid-line splits a paragraph with. Every one must lie
// inside a span the recognizer reports — wider is allowed, narrower is not —
// and no span may hold text Pandoc reads as something opaque: code or math.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks, inlines } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

const RAW = new Set(['RawInline', 'RawBlock']);

function pandocRawTex(text, tabStop) {
  const stdout = readPandoc(text, tabStop);
  const found = [];
  JSON.parse(stdout, (_, value) => {
    if (RAW.has(value?.t) && value.c[0] === 'tex') found.push(value.c[1]);
    return value;
  });
  return found;
}

// Each piece of Pandoc's raw TeX, matched in order to the first span after
// the last match that contains its text.
function uncovered(text, tabStop) {
  const found = blocks(text, { tabStop });
  const spans = [
    ...found.filter((block) => block.type === 'raw-tex'),
    ...inlines(text, found),
  ]
    .sort((a, b) => a.start - b.start)
    .map((s) => text.slice(s.start, s.end));
  const missing = [];
  let at = 0;
  for (const raw of pandocRawTex(text, tabStop)) {
    const hit = spans.findIndex((span, i) => i >= at && span.includes(raw));
    if (hit === -1) missing.push(raw);
    else at = hit + 1;
  }
  return missing;
}

const CASES = {
  'a command with an argument': 'a \\footnote{one two} b',
  'a command with an empty group': 'a \\LaTeX{} b',
  'a command with no argument': 'a \\LaTeX b',
  'nested braces': 'a \\emph{nested {braces} here} b',
  'an optional argument': 'a \\cite[p. 5]{key} b',
  'a space before the argument': 'a \\textbf {spaced} b',
  'two arguments': 'a \\cmd{x}{y} b',
  'a space between arguments': 'a \\cmd{x} {y} b',
  'markdown inside the braces': 'a \\footnote{see *this* one} b',
  'a line break inside the braces': 'a \\footnote{one\ntwo} b',
  'a starred command': 'a \\vspace*{1em} b',
  'a command in a heading': '# Heading \\label{h}',
  'a command in a setext heading': 'Heading \\label{h}\n===',
  'a command in link text': '[link \\emph{x}](u)',
  'an escaped percent sign': 'a \\footnote{50\\% off} b',
  'a URL with an underscore': 'a \\url{http://x.y/a_b} b',
  'an argument then text': 'a \\hspace{1em}text b',
  'an argument one line down': 'a \\textbf\n{x} b',
  'an optional argument the command does not take': 'a \\emph[o]{x}[y] b',
  escapes: 'a \\\\ b \\$ c \\* d',
  'an environment mid-line': 'a \\begin{center}x\\end{center} b',
  'an environment across lines': 'a \\begin{center}\nx\n\\end{center} b',
  'an environment across a blank line': 'a \\begin{x}\n\ny \\end{x} b',
  'a nested environment': 'a \\begin{x}\\begin{x}y\\end{x}\\end{x} b',
  'an environment in a heading': '# Head \\begin{x}y\\end{x} tail',
  'an environment in a list item': '- item \\begin{x}y\\end{x} tail',
  'an environment in emphasis': '*a \\begin{x}y\\end{x} b*',
  'an environment ended by another name': 'a \\begin{x}y\\end{z} b',
  'an environment never ended': 'a \\begin{x}y b',
  'an accent': 'a \\"o b',
  'an unclosed brace': 'a \\x{unclosed b',
  'an inline environment': 'a \\begin{em}x\\end{em} b',
  'a code span': '`\\code{x}` b',
  'a double-backtick code span': '``a ` \\code{x}`` b',
  'inline math': '$\\frac{a}{b}$ and \\emph{x}',
  'a code span broken by a blank line': 'a `b\n\nc` \\emph{x} d',
  'display math broken by a blank line': 'a $$b\n\nc$$ \\emph{x} d',
  'a price': 'price $5 and \\emph{x} $6',
  'an HTML comment': 'a <!-- \\emph{x} --> b',
  'a code block': '```\n\\emph{x}\n```',
  'a raw TeX block': '\\begin{center}\n\\emph{x}\n\\end{center}',
  'a div attribute': '::: {title="\\emph{x}"}\ntext \\emph{y}\n:::',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: all the raw TeX Pandoc keeps is inside a span (tab stop ${tabStop})`, () => {
      assert.deepEqual(uncovered(`${text}\n`, tabStop), []);
    });
  }
}

// The other direction, for what must stay out: text Pandoc reads as code or
// math, where a span would freeze nothing wrong but claim raw TeX that is not.
for (const [name, text] of Object.entries({
  'a code span': '`\\code{x}` b',
  'inline math': '$\\frac{a}{b}$',
  'a code block': '```\n\\emph{x}\n```',
  'an HTML comment': 'a <!-- \\emph{x} --> b',
  'an autolink': 'a <http://x.y/\\emph{x}> b',
})) {
  test(`${name}: no span claims it`, () => {
    assert.deepEqual(inlines(`${text}\n`), []);
  });
}
