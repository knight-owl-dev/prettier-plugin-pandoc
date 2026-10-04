// siunitx in LaTeX, read as Pandoc reads it, with raw TeX off and on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex'];

const CASES = {
  numbers:
    '\\num{12345} \\num{-1.5e3} \\num{.5} \\num{1,5} \\num{1+-0.2} \\num{1\\pm 2} \\num{3i} \\num{2x3} \\num{1.234(5)} \\num{12(3)} \\num{1.20(30)} \\num{abc} \\num{1e} \\num{+7}',
  units:
    '\\si{\\metre} \\si{\\kilo\\gram\\per\\second} \\si[per-mode=symbol]{\\metre\\per\\second} \\si{\\square\\metre} \\si{\\metre\\squared} \\si{m/s} \\si{\\metre\\tothe{-2}} \\si{kg.m^2} \\si{\\micro\\litre} \\unit{\\ohm} \\si{\\bohr} \\si{x_1}',
  quantities:
    '\\SI{1}{\\euro} \\SI{1}[\\$]{} \\SI{9.81}{\\metre\\per\\second\\squared} \\qty{5}{\\kilo\\hertz} \\SI[round-mode=places]{3.14}{\\radian}',
  'ranges and lists':
    '\\SIrange{100}{200}{\\ms} \\numrange{1}{10} \\qtyrange{1}[a]{2}[b]{\\metre} \\SIlist{1;2;3}{\\metre} \\numlist{1;2} \\numlist{1} \\qtylist{5;6}{\\s}',
  angles: '\\ang{30} \\ang{1;2;3} \\ang{;;+5} \\ang{1;2}',
  'powers and per':
    '\\si{\\per\\metre} \\si{\\cubic\\metre\\per\\kilo\\gram} \\si{\\raisetothe{3}\\metre} \\si{\\metre\\cubed\\per\\second\\squared}',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const ext of VARIANTS) {
    test(`${name}: Pandoc's AST (latex${ext})`, () => {
      const extensions = ext.match(/[+-][a-z_]+/g) ?? [];
      assert.deepEqual(
        withoutSpans(readLaTeX(text, { extensions })),
        pandocLaTeXAst(text, ext),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readLaTeX(text).blocks, 0, text.length, 'document');
  });
}

test("spans: a command's output spans nothing, where it starts", () => {
  const text = 'a \\SI{1}[\\$]{} b';
  const [{ c: inlines }] = readLaTeX(text).blocks;
  const made = inlines.slice(2, -2);
  assert.ok(made.length > 0);
  assert.ok(made.every((x) => x.start === 2 && x.end === 2));
});
