// Where inline raw TeX is, checked against Pandoc rather than asserted.
//
// Pandoc's parse keeps each raw inline's text. Every one must lie inside a
// span the recognizer reports — wider is allowed, narrower is not — and no
// span may hold text Pandoc reads as something opaque: code or math.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { inlines } from '../src/index.js';

function pandocRawInlines(text) {
  const run = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], {
    input: text,
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  const found = [];
  JSON.parse(run.stdout, (_, value) => {
    if (value?.t === 'RawInline' && value.c[0] === 'tex')
      found.push(value.c[1]);
    return value;
  });
  return found;
}

// Each Pandoc raw inline, matched in order to the first span after the last
// match that contains its text.
function uncovered(text) {
  const spans = inlines(text).map((s) => text.slice(s.start, s.end));
  const missing = [];
  let at = 0;
  for (const raw of pandocRawInlines(text)) {
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
  'a command in link text': '[link \\emph{x}](u)',
  'an escaped percent sign': 'a \\footnote{50\\% off} b',
  'a URL with an underscore': 'a \\url{http://x.y/a_b} b',
  'an argument then text': 'a \\hspace{1em}text b',
  'an argument one line down': 'a \\textbf\n{x} b',
  'an optional argument the command does not take': 'a \\emph[o]{x}[y] b',
  escapes: 'a \\\\ b \\$ c \\* d',
  'an accent': 'a \\"o b',
  'an unclosed brace': 'a \\x{unclosed b',
  'an inline environment': 'a \\begin{em}x\\end{em} b',
  'a code span': '`\\code{x}` b',
  'a double-backtick code span': '``a ` \\code{x}`` b',
  'inline math': '$\\frac{a}{b}$ and \\emph{x}',
  'a price': 'price $5 and \\emph{x} $6',
  'an HTML comment': 'a <!-- \\emph{x} --> b',
  'a code block': '```\n\\emph{x}\n```',
  'a raw TeX block': '\\begin{center}\n\\emph{x}\n\\end{center}',
  'a div attribute': '::: {title="\\emph{x}"}\ntext \\emph{y}\n:::',
};

for (const [name, text] of Object.entries(CASES)) {
  test(`${name}: every raw inline Pandoc finds is inside a span`, () => {
    assert.deepEqual(uncovered(`${text}\n`), []);
  });
}

// The other direction, for what must stay out: text Pandoc reads as code or
// math, where a span would freeze nothing wrong but claim raw TeX that is not.
for (const [name, text] of Object.entries({
  'a code span': '`\\code{x}` b',
  'inline math': '$\\frac{a}{b}$',
  'a code block': '```\n\\emph{x}\n```',
  'an HTML comment': 'a <!-- \\emph{x} --> b',
})) {
  test(`${name}: no span claims it`, () => {
    assert.deepEqual(inlines(`${text}\n`), []);
  });
}
