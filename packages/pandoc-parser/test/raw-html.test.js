// Inline raw HTML, read as Pandoc reads it, its spans within their parents'.

// cspell:ignore notascheme

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  tags: 'a <b>bold</b> c <em class="x">e</em> <B>x</B> <x-y z="1">q</x-y> <del>x</del>',
  'void tags and attributes':
    'a <br/> b <img src="a.png" alt="x"> c <a b=c/> <a href="u">l</a> <abbr title="t">A</abbr>',
  comments: 'x <!-- comment --> y <!-- a -- b --> z <!--unterminated',
  spans:
    '<span class="c" id="i">s *t*</span> <span>a</span> <span class="smallcaps">a</span> <span style="font-variant:small-caps">a</span>',
  'no tags':
    'a < b, a <3 b, x<y), <www.boe.es/x> <https://example.org> <notascheme:foo> <a "q"> <a b.c="d">',
  'processing instructions and declarations':
    'a <?php echo 1 ?> b <!DOCTYPE html> c x <![CDATA[y]]> z',
  'references and math in tags':
    'a <i>&amp;</i> <i title="&amp;">x</i> <script type="math/tex">x</script>',
  'over lines': 'a <a\nhref="u">x</a> <e>\n</e>\n\na <a\n\nb>',
  'unbalanced spans': 'a <span>b a </span> b a <span>*x</span>*',
  'in link text': '[a <b>]</b>](u)',
  'tags left open': 'a x<y and 3 <4 b\n\nc <b c="d',
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

test('spans: a raw inline is its tag, a span its tags and contents', () => {
  const text = 'a <b>x</b> <span class="c">y</span>\n';
  const [{ c: ils }] = readMarkdown(text).blocks;
  const slice = ({ start, end }) => text.slice(start, end);
  const raws = ils.filter((n) => n.t === 'RawInline');
  assert.deepEqual(raws.map(slice), ['<b>', '</b>']);
  assert.equal(
    slice(ils.find((n) => n.t === 'Span')),
    '<span class="c">y</span>',
  );
});
