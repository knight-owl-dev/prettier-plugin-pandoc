// Which lines form line blocks.
//
// Pandoc's parse gives each line block its verse lines. The recognizer's spans
// must hold the same number of blocks, each opening the same number of verse
// lines; a continuation joins the line above, so it opens none.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

function pandocVerse(text, tabStop) {
  const stdout = readPandoc(text, tabStop);
  const found = [];
  JSON.parse(stdout, (_, value) => {
    if (value?.t === 'LineBlock') found.push(value.c.length);
    return value;
  });
  return found;
}

function recognizerVerse(text, tabStop) {
  return blocks(text, { tabStop })
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
  'a bar line over dashes': '| a\n---\n',
  'a bar line over equals signs': '| a\n===\n',
  'verse over dashes': '| a\n| b\n---\n',
  'a continuation of dashes': '| a\n --\n',
  'verse inside a div': '::: poem\n| a\n| b\n:::\n',
  'a pipe table': '| a | b |\n|---|---|\n| 1 | 2 |\n',
  'bars in a code block': '```\n| a\n```\n',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on the line blocks (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerVerse(text, tabStop),
        pandocVerse(text, tabStop),
      );
    });
  }
}
