// Autolinks, read as Pandoc reads them, their spans within their parents'.

// cspell:ignore İmap

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  URIs: '<http://example.com> <https://x.org/a/b?c=d&e=f#g> <HTTP://X.COM> <doi:10.1000/182> <file:///etc/passwd>',
  'punctuation and parentheses':
    '<http://hi---there> <http://x.com.> <http://en.wikipedia.org/wiki/State_(disambiguation)> <http://x.com/,,a> <http://x.com/{a}[b]>',
  'escapes and references':
    '<http://x.com/&amp;y> <http://x.com/%20> <http://x.com/ü> <http://x.com/> <İmap:x>',
  'e-mail addresses':
    '<me@example.com> <first.last@sub.example.co.uk> <mailto:a@b.c> <a-b@c-d.e>',
  attributes: '<http://x.com>{.c} <http://x.com>{#i}',
  'no autolink':
    '<http://x.com/a b> <http:**bold**> <a@b> <a.@b.c> <a@-b.c> <a@b-.c> <http://a\nb> text <http://x.com>>',
  'no link in a link': '[<http://x.com>](u)',
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

test('spans: an autolink, and its text inside the brackets', () => {
  const text = 'x <http://x.com> y\n';
  const [{ c: ils }] = readMarkdown(text).blocks;
  const slice = ({ start, end }) => text.slice(start, end);
  const link = ils.find((n) => n.t === 'Link');
  assert.equal(slice(link), '<http://x.com>');
  assert.equal(slice(link.c[1][0]), 'http://x.com');
});
