// Reference links and images, read as Pandoc reads them: resolved against
// definitions anywhere in the document, by a second read where needed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  'defined after or before':
    '[a][r] [b][] [c]\n\n[r]: http://x "T"\n[b]: u\n[c]: v\n\n[d][r]',
  'defined twice, the last wins': '[a][r]\n\n[r]: u\n[r]: v\n\n[r]: w',
  unresolved: '[no][where] [no] x [no] [a] [b]\n\n[b]: u',
  images: '![i][r] x ![j] y\n\n![i][r]\n\n[r]: p.png\n[j]: q.png',
  headings:
    '# Head\n\n[Head] [x][Head]\n\n# Other {#o}\n\n[Other]\n\n[Later]\n\n# Later',
  'references in headings':
    '# [a] b\n\n# [c][r]\n\n[a]: u\n[r]: v\n\n[a b] [c]',
  'titles and attributes':
    '[a][r]{.c} [b][s] [c][t] [d][v]\n\n[r]: u {#i .d k=v}\n[s]: <u v> \'t\'\n[t]: u (t)\n[v]: u {id=i class="x y" k=v}',
  'definitions over lines':
    '[r]:\n  u\n  "t"\n\n[s]: u "t"\n {.c}\n\n[x][r] [y][s]',
  'keys normalized':
    '[R  X]: u\n[*a*]: v\n[a [b]]: w\n\n[r x] [*a*] [a [b]] [[a]]',
  'in lists and quotes': '- [a]\n\n  [a]: u\n\n> [b]: v\n\n[b]',
  'links in links': '[![i][p]](u) [![i][l]][l]\n\n[p]: q.png\n[l]: u',
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

test('spans: a reference link, and the text of one unresolved', () => {
  const text = '[a *b*][r] and [c]\n\n[r]: u\n';
  const [{ c: ils }] = readMarkdown(text).blocks;
  const slice = ({ start, end }) => text.slice(start, end);
  assert.equal(slice(ils[0]), '[a *b*][r]');
  assert.deepEqual(ils.slice(-1).map(slice), ['[c]']);
});
