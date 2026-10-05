// Metadata in Markdown, read as Pandoc reads it: the title block, and YAML
// blocks resolved as `Data.Yaml` resolves them, their values read again.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const yaml = (body) => `---\n${body}\n...\n\nBody.`;

const CASES = {
  'a title block':
    '% The *Title*\n% A. One; B. Two\n  C. Three\n% 2024\n\nBody.',
  'a title block, title and date': '% Title\n%\n% Date\n\nBody.',
  'a title on two lines': '% A long\n  title\n\nBody.',
  'a percent sign later': 'Body.\n\n% not a title',
  booleans: yaml(
    'a: yes\nb: No\nc: ON\nd: y\ne: N\nf: off\ng: True\nh: TRUE\ni: tRue',
  ),
  nulls: yaml('a: null\nb: Null\nc: ~\nd:\ne: NULL'),
  numbers: yaml(
    'a: 1\nb: 1.0\nc: 1.50\nd: 0.05\ne: 1e-3\nf: -2\ng: +3\nh: 0x1F\ni: 0o17\nj: 12345678.5\nk: 1e30\nl: .5\nm: 1_000\nn: 190:20:30',
  ),
  'quoted, tagged and block scalars': yaml(
    'a: "yes"\nb: \'1\'\nc: !!str true\nd: >\n  true\ne: |-\n  true\nf: |\n  line one\n\n  line two\ng: !!int 5',
  ),
  'merge keys, duplicates and hidden keys': yaml(
    'base: &b {x: 1, y: 2}\nm:\n  <<: *b\n  y: 3\nl:\n  <<: [{p: 1}, {p: 2, q: 3}]\ndup: first\ndup: second\nhidden_: x',
  ),
  'nested values': yaml(
    'list: [a, "*b*", [c]]\nmap:\n  k: v\n  n:\n    - 1\n    - two',
  ),
  'values read as Markdown': yaml(
    'title: A *title* with `code`\nmulti: a long\n  plain value\nnote: Text[^1]\nlink: "[x](u)"',
  ).replace('Body.', 'Body.\n\n[^1]: The note.'),
  'blocks later in the document':
    'First.\n\n---\na: 1\n---\n\nMiddle.\n\n---\na: 2\nb: 3\n...\n\nEnd.',
  'a title block and YAML':
    '% Title\n% Author\n\n---\nauthor: Other\n...\n\nBody.',
  'comments only': '---\n# just a comment\n...\n\nBody.',
  'a rule, not a block': '---\n\nBody.\n\n---\n',
  'a list, not metadata': '---\n- a\n- b\n---\n\nBody.',
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

test('YAML that does not parse fails the read, as it does Pandoc', () => {
  const text = '---\na: [b\n...\n\nBody.';
  assert.throws(() => pandocAst(text), /pandoc failed/);
  assert.throws(() => readMarkdown(text), /YAML/);
});

test('spans: a title spans its text after the percent sign', () => {
  const text = '% The Title\n\nBody.';
  const { meta } = readMarkdown(text);
  const [first] = meta.title.c;
  assert.equal(text.slice(first.start, first.end), 'The');
});
