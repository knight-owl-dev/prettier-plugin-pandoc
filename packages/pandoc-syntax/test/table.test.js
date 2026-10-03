// Which lines form Pandoc's own tables.
//
// Pandoc's parse gives each table its rows. The recognizer's table spans must
// hold the same number of tables. The cases carry no pipe table, which Pandoc
// counts and the recognizer leaves to prettier.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

const TABLES = new Set(['grid-table', 'simple-table', 'multiline-table']);

function pandocTables(text, tabStop) {
  const stdout = readPandoc(text, tabStop);
  let found = 0;
  JSON.parse(stdout, (_, value) => {
    if (value?.t === 'Table') found++;
    return value;
  });
  return found;
}

const recognizerTables = (text, tabStop) =>
  blocks(text, { tabStop }).filter((block) => TABLES.has(block.type)).length;

const GRID = '+---+---+\n| a | b |\n+===+===+\n| 1 | 2 |\n+---+---+';
const SIMPLE = '  Right  Left\n-------  ----\n     12  12\n    123  123';
const HEADERLESS = '-------  ----\n     12  12\n    123  123\n-------  ----';
const MULTILINE =
  '-------------------\n Centered   Default\n  Header    Aligned\n' +
  '----------- -------\n   First    row\n            here\n-------------------';

const CASES = {
  'a grid table': GRID,
  'a grid table then a text line': `${GRID}\ntext`,
  'a grid table after a paragraph line': `prose\n${GRID}`,
  'a simple table': SIMPLE,
  'a simple table then a text line': `${SIMPLE}\ntext`,
  'a simple table after a paragraph line': `prose\n${SIMPLE}`,
  'a simple table with a caption': `${SIMPLE}\n\nTable: caption`,
  'a headerless simple table': HEADERLESS,
  'a multiline table': MULTILINE,
  'a multiline table then a text line': `${MULTILINE}\ntext`,
  'a dash line with nothing after': 'x\n\n-------  ----',
  'a dash line never closed': 'x\n\n-------\ntext',
  'YAML metadata': '---\ntitle: x\n---',
  'a grid table never closed': '+---+\n| a |',
  'a grid table with a row past its last rule': '+---+\n| a |\n+---+\n| b |',
  'a grid table of rules alone': '+---+\n+---+',
  'a simple table without rows': '  a   b\n --- ---',
  'two tables': `${GRID}\n\n${SIMPLE}`,
  'a table inside a div': `::: wide\n${GRID}\n:::`,
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on the tables (tab stop ${tabStop})`, () => {
      assert.equal(
        recognizerTables(`${text}\n`, tabStop),
        pandocTables(`${text}\n`, tabStop),
      );
    });
  }
}

// Pipe tables, by their rows: Pandoc's header and body rows against the lines
// of each span but the separator.
function pandocPipeRows(text, tabStop) {
  const rows = [];
  JSON.parse(readPandoc(text, tabStop), (_, value) => {
    if (value?.t === 'Table') {
      const [, , , head, bodies] = value.c;
      const body = bodies.reduce((n, b) => n + b[2].length + b[3].length, 0);
      rows.push(head[1].length + body);
    }
    return value;
  });
  return rows;
}

const recognizerPipeRows = (text, tabStop) =>
  blocks(text, { tabStop })
    .filter((block) => block.type === 'pipe-table')
    .map((block) => block.segments.length - 1);

const PIPE_CASES = {
  'a pipe table': '| a | b |\n|---|---|\n| 1 | 2 |',
  'a pipe table without outer pipes': 'a | b\n---|---\n1 | 2\n3 | 4',
  'outer pipes on some rows only': 'a | b\n|---|---|\n1 | 2\n| 3 | 4 |',
  'a pipe table then a line without a pipe': 'a | b\n---|---\n1 | 2\ntext',
  'an escaped pipe in a cell': 'a\\|b | c\n---|---\n1 | 2',
  'only an escaped pipe in the header': 'a \\| b\n---|---',
  'a header indented three spaces': '   a | b\n   ---|---',
  'dashes with no pipe under a row': 'Choose A | B\n------',
  'dashes with no pipe under outer pipes': '| a | b |\n---',
  'one dash under a row': 'x | y\n-',
  'a separator with one pipe': 'a | b\n|---',
};

for (const [name, text] of Object.entries(PIPE_CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on the pipe tables' rows (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerPipeRows(`${text}\n`, tabStop),
        pandocPipeRows(`${text}\n`, tabStop),
      );
    });
  }
}
