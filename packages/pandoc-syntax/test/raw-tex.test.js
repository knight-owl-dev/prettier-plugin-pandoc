// Which text is raw TeX.
//
// Pandoc's parse names each raw TeX block and keeps its text. The recognizer's
// spans must cover the same text, in the same order. Pandoc drops an
// environment's indentation from what it keeps, so both sides are compared
// with each line's leading space removed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

const unindent = (raw) => raw.replace(/^[ \t]+/gm, '');

// Every raw TeX block, wherever it sits, in document order.
function pandocRaw(text, tabStop) {
  const stdout = readPandoc(text, tabStop);
  const found = [];
  JSON.parse(stdout, (_, value) => {
    if (value?.t === 'RawBlock' && value.c[0] === 'tex') found.push(value.c[1]);
    return value;
  });
  return found.map(unindent);
}

function recognizerRaw(text, tabStop) {
  return blocks(text, { tabStop })
    .filter((block) => block.type === 'raw-tex')
    .map((block) => unindent(text.slice(block.start, block.end)));
}

const CASES = {
  'an environment': '\\begin{center}\nx\n\\end{center}\n',
  'a command line': '\\newpage\n',
  'consecutive command lines': '\\newpage\n\\clearpage\n',
  'a command with arguments': '\\newcommand{\\foo}{bar}\n',
  'a command then text': '\\newpage\ntext after\n',
  'an environment then text': '\\begin{center}\nx\n\\end{center}\ntext\n',
  'an environment ending mid-line': '\\begin{center}\nx\n\\end{center} tail\n',
  'an unclosed environment': '\\begin{center}\nx\n\n::: note\ntext\n:::\n',
  'an environment with a blank line':
    '\\begin{center}\nx\n\ny\n\\end{center}\n',
  'nested environments':
    '\\begin{center}\n\\begin{tabular}{c}\nx\n\\end{tabular}\n\\end{center}\n',
  'the same environment nested':
    '\\begin{minipage}{1in}\n\\begin{minipage}{1in}\nx\n\\end{minipage}\n\\end{minipage}\n',
  'an indented environment': '  \\begin{center}\n  x\n  \\end{center}\n',
  'a command with a trailing comment': '\\newpage % why\n',
  'inline TeX opening a paragraph': '\\emph{x} and prose\n',
  'an environment inside a div':
    '::: latex-only\n\\begin{center}\nx\n\\end{center}\n:::\n',
  'an environment interrupting a paragraph':
    'prose\n\\begin{center}\nx\n\\end{center}\n',
  'a command continuing a paragraph': 'prose\n\\newpage\n',
  'an environment in a code block':
    '```\n\\begin{center}\nx\n\\end{center}\n```\n',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on the raw TeX (tab stop ${tabStop})`, () => {
      assert.deepEqual(recognizerRaw(text, tabStop), pandocRaw(text, tabStop));
    });
  }
}
