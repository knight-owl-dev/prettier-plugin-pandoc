// What Pandoc parses a second time: block quotes, superscript and
// subscript. Their AST is Pandoc's, and their spans, at any depth, lie in
// order within their parent's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Node, readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'a block quote': '> a *quote*\n> on two lines',
  'lazy lines': '> quote\nlazy line\n  indented lazy\n\nafter',
  'nested quotes': '> > nested\n> back out\n>\n> > again',
  'blocks in a quote':
    '> # Head\n>\n>     code\n>\n> ```\n> fence\n> ```\n>\n> ***',
  'markers indented, and with no space after':
    '   > three spaces\n>no space\n>  two',
  'a quote ending at the document end': '> last',
  'quotes split by a blank line': '> one\n\n> two',
  superscript: 'x^2^ and a^b\\ c^ and ^^ and 2^10^',
  subscript: 'H~2~O and e~&amp;~ and ~x\\~y~',
  'scripts holding markup': 'x^*a*^ and y~`c`{.d}~ and z^a&#x41;b^',
  'scripts that never close': 'x^2 and y~3 and 4^ 5',
  'strikeout and subscript together': '~~a~~ ~b~ ~~~c~~~ ~~ d~~',
  'quotes holding scripts': '> x^2^ and H~2~O\n> lazy^b^',
  'a tab or carriage return decoded into a chunk':
    "^&#9;x^^!!!!!'y'^ and ^&#9;x^ ^!!!!!!!!!_y_^ and ^a&#13;b^ and ^&#13;x^ ^!!_y_^",
  'sibling chunks, a word ending where the next opens':
    "^a^ ^\\*_b_^ and ^a^ ^\\*'b'^ and ^ab^ ^\\*_b_^\n\n^a^\n^\\*_b_^\n\nx^a^\n\n^\\*_b_^\n\n> a^b^\n> ^\\*_c_^",
  'a word ending where a chunk word ends':
    "a^\\*_a_^ and a~\\*_a_~ and a^\\*'b'^\n\n> a^\\*_e_^",
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

// Each node's children, in order.
const childrenOf = (node) => {
  const out = [];
  const visit = (v) => {
    if (v instanceof Node) out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
  };
  visit(node.c);
  return out;
};

// Every node within `[start, end)`, in order, each within its own.
function assertNested(nodes, start, end, path) {
  let last = start;
  for (const node of nodes) {
    const at = `${path} > ${node.t}`;
    assert.ok(
      node.start >= last,
      `${at} starts at ${node.start}, before ${last}`,
    );
    assert.ok(node.end >= node.start, `${at} ends before it starts`);
    assert.ok(node.end <= end, `${at} ends at ${node.end}, past ${end}`);
    assertNested(childrenOf(node), node.start, node.end, at);
    last = node.end;
  }
}

for (const [name, text] of Object.entries(CASES)) {
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readMarkdown(text).blocks, 0, text.length, 'document');
  });
}

const spans = (text) => {
  const out = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      out.push([node.t, text.slice(node.start, node.end)]);
      visit(childrenOf(node));
    }
  };
  visit(readMarkdown(text).blocks);
  return out;
};

test('spans: a quote, its lines and the markers between them', () => {
  assert.deepEqual(spans('> a *b*\n> c'), [
    ['BlockQuote', '> a *b*\n> c'],
    ['Para', 'a *b*\n> c'],
    ['Str', 'a'],
    ['Space', ' '],
    ['Emph', '*b*'],
    ['Str', 'b'],
    ['SoftBreak', '\n> '],
    ['Str', 'c'],
  ]);
});

test('spans: a decoded escape in a superscript spans the escape', () => {
  assert.deepEqual(spans('a^b\\ c^'), [
    ['Para', 'a^b\\ c^'],
    ['Str', 'a'],
    ['Superscript', '^b\\ c^'],
    ['Str', 'b\\ c'],
  ]);
});
