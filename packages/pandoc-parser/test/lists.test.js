// Bullet, ordered, example and task lists, read as Pandoc reads them, their
// spans within their parents' at any depth.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  'tight and loose bullet lists': '- a\n- b\n\n* c\n\n* d',
  'mixed bullets': '* a\n+ b\n- c',
  'ordered lists': '1. one\n2. two\n\n3. three\n4. four',
  'fancy markers': 'a) x\nb) y\n\n(i) r\n(ii) s\n\nI. A\nII. B\n\n#. d\n#. e',
  'a delimiter change': '1) a\n2. b',
  'initials, not markers': 'A. Smith\nB. Jones',
  'example lists': '(@) ex\n(@lab) two\n\nsee\n\n(@) three\n\n3@. counted',
  'task lists': '- [ ] todo\n- [x] done\n- [X] also\n- [ ]\n- [ ] a\n\n  b',
  'nested lists':
    '- a\n  - nested\n  - more\n- b\n    - deep\n        - deeper',
  'items with blocks':
    '- item\n\n  continued para\n\n- a\n\n  ```\n  code\n  ```\n\n- b\n\n      code',
  'lazy lines': '- lazy\ncontinuation\n\n1. a\n   lazy\nmore lazy\n2. b',
  'lists in quotes': '> - in quote\n> - two\n\n> 1. q\n>    lazy',
  'a paragraph line before a dash': 'para\n- not list',
  'a thematic break, then a list': '* * *\n\n- x',
  'empty items': 'x\n\n- a\n\n-\n\n- c',
  'wide markers': '-   wide\n\n    indented para\n\n10. ten\n11. eleven',
  'headings in items': '- # head in item\n- ## another',
  'a list after blank lines': '- a\n\n\n- b',
  'hard breaks ending tight items':
    '- a  \n- b\n\n1. a  \n2. b\n\n- - a  \n- b\n\n- a\n  b  \n- c\n\n> - a  \n> - b',
  'quotes in tight items': '10. > quote\ni. foo\n\n- > a\n- b',
  'huge start numbers':
    '99999999999999999999. a\n\n- x\n\n  18446744073709551617. y',
  'lines blank but for other spaces': 'a\n\u00a0\n\nb\n\n- c\n  \u3000\n',
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

test('spans: a list runs to its last line, an item block to its own', () => {
  const text = '- a *b*\n- c\n\n  d\n\n';
  const [list] = readMarkdown(text).blocks;
  assert.equal(text.slice(list.start, list.end), '- a *b*\n- c\n\n  d');
  const [[first], [, second]] = list.c;
  assert.equal(text.slice(first.start, first.end), 'a *b*');
  assert.equal(text.slice(second.start, second.end), 'd');
});
