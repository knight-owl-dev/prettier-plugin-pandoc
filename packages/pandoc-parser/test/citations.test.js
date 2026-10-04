// Citations and example references, read as Pandoc reads them, their
// spans within their parents'.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  'in brackets':
    '[@doe99] [see @doe99, p. 33] [@doe99; @smith2000] [-@doe99] [@a;@b] [ @a ] [@a ; @b]',
  'prefixes and suffixes':
    '[see @doe99, pp. 33-35; also @smith04, chap. 1] [@a, p. *3*] [*see* @a]',
  'in text': 'Doe says @doe99. -@a says @a:b.c @a. @a-b @_x @*',
  'in text with a locator':
    '@doe99 [p. 33] says @doe99 [p. 33; @x] @doe99[p. 3] @doe99 [-@x]\n\n@doe99\n[p. 3]',
  'braced keys': '[@{key with spaces}] @{braced}',
  'not citations': 'mail@example.com [@a](url) [@a]{.c} x [@a] [b]',
  'links after': '@a [ref] and @a [nolink] and [@a][r]\n\n[ref]: u\n[r]: v',
  'example references':
    '(1) @good\n\n(@good) text\n\nSee @good, @unknown, @.\n\n(@) a\n(@b) b\n\n@b',
  'an example reference before its example': 'See @good.\n\n(@good) text',
  'in notes':
    'a[^1] [@x] b[^2] c [@y] ^[inline @q] [@r]\n\n[^1]: See @doe.\n\n[^2]: n [@z]',
  'after an abbreviation and in headings': 'Mr. [@a] Mr. @a\n\n# @a\n\n[@a]',
  'no reference key': '[@a]: url',
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

test('spans: a citation, its prefix and its suffix', () => {
  const text = 'x [see @doe, p. 3] y\n';
  const [{ c: ils }] = readMarkdown(text).blocks;
  const slice = ({ start, end }) => text.slice(start, end);
  const cite = ils.find((n) => n.t === 'Cite');
  assert.equal(slice(cite), '[see @doe, p. 3]');
  const [{ citationPrefix, citationSuffix }] = cite.c[0];
  assert.deepEqual(citationPrefix.map(slice), ['see']);
  assert.equal(citationSuffix.map(slice).join(''), ', p. 3');
});
