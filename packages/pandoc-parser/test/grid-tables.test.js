// Grid tables, read as Pandoc reads them, their rows' spans within their
// table's and each cell's contents within its row's, or its table's where
// it spans rows.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const FRUIT = `+---------------+---------------+--------------------+
| Fruit         | Price         | Advantages         |
+===============+===============+====================+
| Bananas       | $1.34         | - built-in wrapper |
|               |               | - bright color     |
+---------------+---------------+--------------------+
| Oranges       | $2.10         | - cures scurvy     |
|               |               | - tasty            |
+---------------+---------------+--------------------+`;

const CASES = {
  'a head and blocks in cells': FRUIT,
  'cells spanning rows and columns': `+---------------------+----------+
| Property            | Earth    |
+=============+=======+==========+
|             | min   | -89.2 °C |
| Temperature +-------+----------+
| 1961-1990   | mean  | 14 °C    |
|             +-------+----------+
|             | max   | 56.7 °C  |
+-------------+-------+----------+`,
  alignment: `+---------------+---------------+--------------------+
| Right         | Left          | Centered           |
+==============:+:==============+:==================:+
| Bananas       | $1.34         | built-in wrapper   |
+---------------+---------------+--------------------+

+--------------:+:--------------+:------------------:+
| Right         | Left          | Centered           |
+---------------+---------------+--------------------+`,
  'a foot': `+-----+-----+
| a   | b   |
+=====+=====+
| 1   | 2   |
+=====+=====+
| f   | g   |
+=====+=====+`,
  'small tables':
    '+---+\n| x |\n+---+\n\n+---+\n|   |\n+---+\n\n+--+\n|ab|\n+--+',
  'wide characters': '+---+---+\n| 日本 | b |\n+---+---+',
  'short lines': '+---+\n| x\n+---+\n\n+---+---+\n| a | b\n+---+---+',
  'a cell over a row': '+---+---+\n| a | b |\n+---+---+\n| c     |\n+-------+',
  'lines in a cell': '+-----+\n| a   |\n|     |\n| b   |\n+-----+',
  'indented, captioned, in lists and quotes':
    '  +---+\n  | x |\n  +---+\n\n+---+\n| *x* |\n+---+\n\nTable: cap\n\n- item\n\n  +---+\n  | x |\n  +---+\n\n> +---+\n> | x |\n> +---+',
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

test("spans: a grid table's rows and a cell's contents", () => {
  const [table] = readMarkdown(FRUIT).blocks;
  const slice = ({ start, end }) => FRUIT.slice(start, end);
  const [, , , [, [head]], [[, , , [first]]]] = table.c;
  assert.equal(
    slice(head),
    '| Fruit         | Price         | Advantages         |',
  );
  const [, , , , [list]] = first.cells.at(-1);
  assert.equal(list.t, 'BulletList');
  const [[wrapper]] = list.c;
  assert.equal(slice(wrapper), 'built-in wrapper');
});
