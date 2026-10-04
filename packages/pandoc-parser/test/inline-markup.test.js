// Emphasis, strikeout, code spans, escapes and character references, read
// as Pandoc reads them.

// cspell:ignore ngeqq

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'emphasis and strong': '*a* **b** ***c*** _d_ __e__ ___f___',
  'intraword underscores': 'snake_case_word, a*b*c and _emph_ed',
  'unclosed delimiters': '**unclosed and *also and _too',
  'nested emphasis': '*a **b** c* and **a *b* c** and _a __b__ c_',
  'three, closed by two then one': '***a** b* and ***a* b**',
  'four delimiters': '****x**** and ____y____',
  'a space after the delimiters': 'x * not emph * and ** not strong **',
  'emphasis across lines': '*a\nb* and **c  \nd**',
  'quotes in emphasis': '*"quoted"* and _\'single\'_',
  'code spans': '`a` `` a`b `` ``` x ``` and `a\nb`',
  'an unclosed code span': '`unclosed and ``x`',
  'code attributes': '`x`{.c #i k=v} `y`{.c k="a b" j=\'v w\'} `z`{-}',
  'raw attributes': '`\\begin{x}`{=latex} and `<b>`{=html}',
  'code spaces': '` ` and `  a  ` and ` `` `',
  // An unclosed `~~` is subscript's, which re-parses: not ported yet.
  strikeout: '~~a~~ and ~~two words~~ and ~~a *b* c~~',
  'mark, off by default': '==mark== text',
  escapes: '\\*not\\* \\_no\\_ \\` \\\\ \\# \\. \\! \\[x\\]',
  'an escaped space': 'a\\ b',
  'an escaped line break': 'a\\\nb',
  'character references':
    '&amp; &lt; &copy; &#169; &#xA9; &#X41; &ngeqq; &Afr; &nbsp;x',
  'invalid character references': '&#0; &#1114112; &#xD800; &bogus; &amp no',
  'hex references with a 0x prefix': '&#x0x41; &#X0X42; &#x0X43; &#0x44;',
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

// Each inline and the source it spans.
const spans = (text) => {
  const out = [];
  const visit = (v) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v?.t !== undefined && v.start !== undefined) {
      if (v.t !== 'Para') out.push([v.t, text.slice(v.start, v.end)]);
      visit(Array.isArray(v.c) ? v.c.filter((x) => typeof x === 'object') : []);
    }
  };
  visit(readMarkdown(text).blocks);
  return out;
};

test('spans: emphasis, strong and the delimiters each closes', () => {
  assert.deepEqual(spans('***a*** **b'), [
    ['Strong', '***a***'],
    ['Emph', '*a*'],
    ['Str', 'a'],
    ['Space', ' '],
    ['Str', '**b'],
  ]);
});

test('spans: code spans with attributes, escapes and references', () => {
  assert.deepEqual(spans('`x`{.c} \\* &amp;'), [
    ['Code', '`x`{.c}'],
    ['Space', ' '],
    ['Str', '\\*'],
    ['Space', ' '],
    ['Str', '&amp;'],
  ]);
});
