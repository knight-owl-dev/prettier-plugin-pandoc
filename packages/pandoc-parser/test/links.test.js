// Inline links, images, bracketed spans and implicit figures, read as
// Pandoc reads them, their spans within their parents'.

// cspell:ignore VBOR

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  links: '[a](http://x.com) [a *b*](u "t") [a](u \'t\') [a](u (t))',
  'targets in angles, with spaces, attributes':
    '[a](<u v>) [a]( u  v ) [a](u){#i .c k=v} [a](u\\)v) [a](u&amp;v)',
  'escaped targets': '[a](ü ß) [a](u|v{}^) [a](#frag) [a](u "")',
  'targets over lines': '[a](u\nv) [a](u\n"t")\n\n> [a](u\n> v)',
  'titles in titles': '[a](u "t "q" r") [a](u "t"x")',
  'brackets in the text':
    '[a [b] c](u) [a `]` b](u) [a \\] b](u) [a $]$ b](u) [a\nb](u)',
  'no link': '[a\n\nb](u) [a]( [a](u [a] (u) [a] b [^1] ![a]',
  'no link in a link': '[[a](u)](v) [ a ](u)',
  'data URIs':
    '[a](data:image/png;base64,iVBOR==) [a](data:image/png;base64,iV BOR)',
  images: 'x ![a](i.png) y ![](i.png) ![a](i.png "t"){width=50%}',
  'implicit figures':
    '![a](i.png)\n\n![a](i.png){alt="b c"}\n\n![a](i.png){latex-placement=h #f .c}\n\n![](i.png)',
  spans: '[a]{.smallcaps} [a]{.ul .x} [a]{#i} [a]{} [a]{.underline .smallcaps}',
  'a small-caps style': '[a]{style="font-variant: small-caps;"}',
  nested: '*[a](u)* - [a](u)\n- ![b](c)\n\n[a](u) [b](v)',
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

test('spans: a link, its text and its image', () => {
  const text = 'x [a *b*](u "t") ![c](i)\n';
  const [{ c: ils }] = readMarkdown(text).blocks;
  const slice = ({ start, end }) => text.slice(start, end);
  const link = ils.find((n) => n.t === 'Link');
  assert.equal(slice(link), '[a *b*](u "t")');
  assert.deepEqual(link.c[1].map(slice), ['a', ' ', '*b*']);
  assert.equal(slice(ils.find((n) => n.t === 'Image')), '![c](i)');
});
