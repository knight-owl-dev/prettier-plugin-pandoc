// Which lines form line blocks, checked against Pandoc rather than asserted.
//
// Pandoc's parse gives each line block its verse lines. The recognizer's spans
// must hold the same number of blocks, each opening the same number of verse
// lines; a continuation joins the line above, so it opens none.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { blocks } from '../src/index.js';

function pandocVerse(text) {
  const run = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], {
    input: text,
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  const found = [];
  JSON.parse(run.stdout, (_, value) => {
    if (value?.t === 'LineBlock') found.push(value.c.length);
    return value;
  });
  return found;
}

function recognizerVerse(text) {
  return blocks(text)
    .filter((block) => block.type === 'line-block')
    .map(
      (block) =>
        text
          .slice(block.start, block.end)
          .split('\n')
          .filter((line) => /^\|( |$)/.test(line)).length,
    );
}

const CASES = {
  'verse lines': '| a\n| b\n',
  'a continuation line': '| a long\n  continued\n| b\n',
  'a text line straight after': '| a\n| b\ntext\n',
  'a blank line between two blocks': '| a\n\n| b\n',
  'an empty verse line': '| a\n|\n| b\n',
  'an indented bar': '  | a\n  | b\n',
  'a bar with no space after': '|a\n',
  'a bar after a paragraph line': 'prose\n| a\n',
  'inline markup and indented verse':
    '| *em* and **strong**\n|    indented verse\n',
  'a heading straight after': '| a\n# H\n',
  'verse inside a div': '::: poem\n| a\n| b\n:::\n',
  'a pipe table': '| a | b |\n|---|---|\n| 1 | 2 |\n',
  'bars in a code block': '```\n| a\n```\n',
};

for (const [name, text] of Object.entries(CASES)) {
  test(`${name}: the recognizer and Pandoc agree on the line blocks`, () => {
    assert.deepEqual(recognizerVerse(text), pandocVerse(text));
  });
}
