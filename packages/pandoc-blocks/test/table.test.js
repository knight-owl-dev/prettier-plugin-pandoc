// Which lines form Pandoc's own tables, checked against Pandoc rather than
// asserted.
//
// Pandoc's parse gives each table its rows. The recognizer's table spans must
// hold the same number of tables. The cases carry no pipe table, which Pandoc
// counts and the recognizer leaves to prettier.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { blocks } from '../src/index.js';

const TABLES = new Set(['grid-table', 'simple-table', 'multiline-table']);

function pandocTables(text) {
  const run = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], {
    input: text,
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  let found = 0;
  JSON.parse(run.stdout, (_, value) => {
    if (value?.t === 'Table') found++;
    return value;
  });
  return found;
}

const recognizerTables = (text) =>
  blocks(text).filter((block) => TABLES.has(block.type)).length;

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
  'two tables': `${GRID}\n\n${SIMPLE}`,
  'a table inside a div': `::: wide\n${GRID}\n:::`,
};

for (const [name, text] of Object.entries(CASES)) {
  test(`${name}: the recognizer and Pandoc agree on the tables`, () => {
    assert.equal(recognizerTables(`${text}\n`), pandocTables(`${text}\n`));
  });
}
