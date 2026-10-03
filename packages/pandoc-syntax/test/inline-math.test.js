// Where inline math is.
//
// Pandoc keeps a formula's text, line breaks and spaces included, so a caller
// must leave it as written. Each math span the recognizer reports must hold
// one formula Pandoc reads, and every formula must lie in one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlines } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

function pandocMath(text, tabStop) {
  const found = [];
  JSON.parse(readPandoc(text, tabStop), (_, value) => {
    if (value?.t === 'Math') found.push(value.c[1]);
    return value;
  });
  return found;
}

// Each span's formula: its text without the dollars around it, or a
// container's indentation on its later lines.
const recognizerMath = (text) =>
  inlines(text)
    .filter((span) => span.type === 'math')
    .map((span) =>
      text
        .slice(span.start, span.end)
        .replace(/^\$+|\$+$/g, '')
        .replace(/\n[ \t]*/g, '\n'),
    );

const CASES = {
  'a formula': 'a $x + y$ b',
  'a formula across lines': 'w $x\ny$ b',
  'display math': 'a $$x + y$$ b',
  'two formulas': 'a $x$ and $y$ b',
  'a price': 'price $5 and $6',
  'a formula after a price': 'price $5 then $x$ b',
  'an escaped dollar': 'a \\$x$ b',
  'a formula in a code span': '`$x$` b',
  'a formula in emphasis': '*a $x + y$ b*',
  'a formula in a list item': '- w\n  $x\n  a) y$',
  'a formula broken by a blank line': 'a $x\n\ny$ b',
  'a dollar that cannot close': 'a $x $y$ b',
  'a dollar in a balanced group': 'text $\\text{$x y z$}$ more',
  'a group holding a closing dollar': 'a $\\text{a $}$ b',
  'an unbalanced brace': 'a ${x$ b',
  'a dollar in a plain group': 'word $a + b + c {$ d} e',
  'a dollar in an mbox': 'a $\\mbox{$x$}$ b',
  'a space before a text group': 'a $\\text {$x$}$ b',
  'an escaped space before the close': 'a $a + b\\ $ c',
  'a no-break space before the close': 'a $x *y* z\u00a0$ b',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: each formula Pandoc reads is a math span (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerMath(`${text}\n`),
        pandocMath(`${text}\n`, tabStop),
      );
    });
  }
}
