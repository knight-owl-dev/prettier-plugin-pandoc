// TeX math, read as Pandoc reads it, its spans within their parents'.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  inline: 'x $y^2$ z, **$a$**, $a$$b$',
  display: '$$\\int_0^1 f$$ and $$$x$$$',
  'not math': 'costs $5 and $10, $ x$, $a$5, $x, $$, $ $, \\$x$',
  'trimmed, an escaped space kept': '$x $ and $a\\ $ and $a \\\n b$',
  '\\text and escapes': '$\\text{a $b$ c}$ d, $\\text{a\\}b}$, $\\$$',
  'over lines': '$a\nb$ $a\n\nb$\n\n$$a\nb$$ $$a\n\nb$$',
  'an apostrophe after': "$x$'s value, $x$' alone",
  'in a list and a quote': '- $x$\n- $$y$$\n\n> $a\n> b$',
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
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readMarkdown(text).blocks, 0, text.length, 'document');
  });
}

test('spans: math runs from its opening delimiter to its closing one', () => {
  const text = 'a $x^2$ and $$y$$\n';
  const [{ c: inlines }] = readMarkdown(text).blocks;
  const math = inlines.filter((n) => n.t === 'Math');
  assert.deepEqual(
    math.map((n) => text.slice(n.start, n.end)),
    ['$x^2$', '$$y$$'],
  );
});
