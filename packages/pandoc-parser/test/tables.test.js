// Simple and multiline tables, read as Pandoc reads them, their rows' spans
// within their table's and each cell's contents within its row's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const MULTILINE = `-------------------------------------------------------------
 Centered   Default           Right Left
  Header    Aligned         Aligned Aligned
----------- ------- --------------- -------------------------
   First    row                12.0 Example of a row that
                                    spans multiple lines.

  Second    row                 5.0 Here's another one. Note
                                    the blank line between
                                    rows.
-------------------------------------------------------------

Table: Here's the caption. It, too, may span
multiple lines.`;

const CASES = {
  'a simple table': `  Right     Left     Center     Default
-------     ------ ----------   -------
     12     12        12            12
    123     123       123          123
      1     1          1             1

Table:  Demonstration of simple table syntax.`,
  'a headless simple table': `-------     ------ ----------   -------
     12     12        12             12
    123     123       123           123
-------     ------ ----------   -------`,
  'a multiline table': MULTILINE,
  'a headless multiline table': `----------- ------- --------------- -------------------------
   First    row                12.0 Example of a row that
                                    spans multiple lines.

  Second    row                 5.0 Here's another one.
----------- ------- --------------- -------------------------

: Here's a multiline table without a header.`,
  'a caption first, with attributes':
    ': Caption first {#tbl .c}\n\na  b\n-- --\n1  2\n',
  'wide characters': 'a    b\n---- --\n日本 2\n語x  3\n',
  'a cell of newlines alone': '  -- --\nx',
  'empty cells and a short row': 'a   b   c\n--- --- ---\n1\n    2\n\n',
  'in a quote and an item':
    '> a  b\n> -- --\n> 1  2\n\n- a  b\n  -- --\n  1  2',
  'in a div': '::: d\na  b\n-- --\n1  2\n:::',
  'a definition, not a caption': 'Term\n\n:   Def\n\na  b\n-- --\n1  2',
  'a caption, not a definition': 'Term\n\n: caption\n\na  b\n-- --\n1  2',
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

test("spans: a multiline table's rows and a cell's lines", () => {
  const [table] = readMarkdown(MULTILINE).blocks;
  const slice = ({ start, end }) => MULTILINE.slice(start, end);
  assert.match(slice(table), /^-{61}\n[\s\S]*multiple lines\.$/);
  const [, , , [, [header]], [[, , , [first]]]] = table.c;
  assert.equal(
    slice(header),
    ' Centered   Default           Right Left\n  Header    Aligned         Aligned Aligned',
  );
  assert.match(slice(first), /^ {3}First[\s\S]*multiple lines\.$/);
  const [, , , , [last]] = first.cells.at(-1);
  const at = (t, c) => last.c.find((n) => n.t === t && n.c === c);
  const that = at('Str', 'that');
  const spans = at('Str', 'spans');
  assert.equal(slice(spans), 'spans');
  assert.ok(spans.start > MULTILINE.indexOf('\n', that.end));
  const join = last.c.find((n) => n.t === 'SoftBreak');
  assert.deepEqual([join.start, join.end], [that.end, that.end]);
});
