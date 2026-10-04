// Pipe tables, read as Pandoc reads them, their rows' spans within their
// table's and each cell's contents within its row's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const WIDE = `| Name | Description that is long enough to make this line wider than the text's columns |
|------|----------------------------------------------------------------------|
| a    | b |`;

const CASES = {
  alignments:
    '| Right | Left | Default | Center |\n|------:|:-----|---------|:------:|\n|   12  |  12  |    12   |    12  |\n|  123  |  123 |   123   |   123  |',
  'no outer pipes': 'fruit| price\n-----|-----:\napple|2.05\npear|1.37',
  'one column': '| a |\n|---|\n| b |\n\na |\n-- |\nb |',
  'no pipes, no table': 'a\n---\nb',
  'relative widths, a line wider than the text': WIDE,
  'pipes in code, math and escapes':
    '| a | b |\n|---|---|\n| `x|y` | $p|q$ \\| r |\n| <span>|</span> | \\cite{a|b} |',
  'cells fewer and more than columns':
    '| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |',
  'an empty header': '|   |   |\n|---|---|\n| a | b |',
  'a header alone': '| a | b |\n|---|---|',
  'plus signs in the break': '| a | b |\n|---+---|\n| c | d |',
  captions:
    'Table: Before.\n\n| a |\n|---|\n| b |\n\n| c |\n|---|\n| d |\n\n: After.',
  'inline markup': '| *a* | **b** |\n|-----|-------|\n| [l](u) | `c` |',
  'indented and in lists':
    '   | a | b |\n   |---|---|\n   | c | d |\n\n- | a |\n  |---|\n  | b |',
  'a break line not a break': '| a | b |\n|---|-x-|\n| c | d |',
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

test('spans: a cell spans its text between the pipes, trimmed', () => {
  const text = '| a b | c |\n|---|---|\n|  d  | e |\n';
  const [table] = readMarkdown(text).blocks;
  const [, , , [, [header]], [[, , , [row]]]] = table.c;
  const plainOf = (cell) => cell[4][0];
  assert.equal(text.slice(header.start, header.end), '| a b | c |');
  const d = plainOf(row.cells[0]);
  assert.equal(text.slice(d.start, d.end), 'd');
});
