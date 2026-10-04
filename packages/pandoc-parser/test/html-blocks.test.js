// HTML blocks, read as Pandoc reads them, their spans within their
// parents'.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  divs: '<div>x</div>\n\n<div class="a" id="b">\n\n*md*\n\n</div>\n\n<DIV>x</DIV>',
  'nested and unclosed divs':
    '<div>\n<div>\nin\n</div>\n</div>\n\n<div>unclosed',
  'markdown inside block tags':
    '<section>\n\n# Head\n\n- list\n\n</section>\n\n<details>\n<summary>S</summary>\n\nbody\n\n</details>',
  'tables and lists':
    '<table>\n<tr><td>*x*</td></tr>\n</table>\n\n<ul>\n<li>one</li>\n</ul>',
  verbatim:
    '<pre>\n*no md*\n</pre>\n\n<script>\nvar x = "<b>";\n</script>\n\n<style>p{}</style>\n\n<textarea>\na\n</textarea>',
  'comments and processing instructions':
    '<!-- comment -->\npara\n\n<?xml version="1.0"?>\ntext\n\n<!DOCTYPE html>\n<html><body>x</body></html>',
  'void tags': '<hr>\n\n<hr/>\n\ntext\n\n<br>\ntext\n\n<img src="x">',
  'indentation inside':
    '<p>\n  indented\n</p>\n\n<td>    text</td>\n\n<div>\n\n    code\n\n</div>',
  'a closing tag ends a paragraph':
    'text <p>para</p>\n\n<div>\npara\n</div>\nafter\n\na\n<div>b</div>\n\n<p>a\n\n</p>',
  'in lists and quotes':
    '- item\n\n  <div>in</div>\n\n- two\n\n> <div>q</div>\n\n<div>\n- a\n- b\n</div>',
  'attributes rendered again':
    '<p class=x>a</p><p>b</p> <div markdown="1">*x*</div>',
  'tags either block or inline':
    '<video src="v"></video>\n\n<del>x</del>\n\n<div>a <b>c</b></div>\n\n</div>\n\n<span>x</span>\n\n<div>y</div>',
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

test('spans: a block tag, its contents and its closing tag', () => {
  const text = '<section>\n\n*a*\n\n</section>\n';
  const blocks = readMarkdown(text).blocks;
  const slice = ({ start, end }) => text.slice(start, end);
  assert.deepEqual(blocks.map(slice), ['<section>', '*a*', '</section>']);
});
