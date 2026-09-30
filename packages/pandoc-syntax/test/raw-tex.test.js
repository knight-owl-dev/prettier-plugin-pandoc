// Which text is raw TeX.
//
// Pandoc's parse names each raw TeX block and keeps its text. The recognizer's
// spans must cover the same text, in the same order, and no other block may
// open inside one. Pandoc drops an environment's indentation from what it
// keeps, so both sides are compared with each line's leading space removed.

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
    .map((block) =>
      unindent(
        block.segments.map((s) => text.slice(s.start, s.end)).join('\n'),
      ),
    );
}

// The blocks that open inside a raw span, as text.
function openedInside(text, tabStop) {
  const found = blocks(text, { tabStop });
  const raws = found.filter((block) => block.type === 'raw-tex');
  return found
    .map((block) => (block.type === 'div' ? block.open : block))
    .filter(({ start }) => raws.some((r) => r.start < start && start < r.end))
    .map(({ start, end }) => text.slice(start, end));
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
  'an environment then another': '\\begin{x}y\\end{x} \\begin{z}w\\end{z} c\n',
  'an environment, text, then another':
    '\\begin{x}y\\end{x} b \\begin{z}w\\end{z} c\n',
  'an environment, text, then another below':
    '\\begin{x}y\\end{x} tail\n\\begin{z}w\\end{z}\n',

  // An environment in paragraph text ends the paragraph at its `\begin`.
  'an environment mid-line': 'a \\begin{x}y\\end{x} b\n',
  'a block quote inside a mid-line environment':
    'a \\begin{x} b\n\n> c \\end{x} d\n',
  'a fence inside a mid-line environment':
    'a \\begin{x} b\n```\n\\end{x}\n```\n',
  'a div fence inside a mid-line environment':
    '::: n\na \\begin{x} b\n:::\n\\end{x} c\n:::\n',
  'a list inside a mid-line environment in a list item':
    '- a \\begin{x} b\n\n  - c \\end{x} d\n',
  'a mid-line environment in a block quote':
    '> a \\begin{x} b\n>\n> c \\end{x} d\n',
  'a mid-line environment ending past its block quote':
    '> a \\begin{x} b\n\nc \\end{x} d\n',
  'a mid-line environment ending on a lazy line':
    '> a \\begin{x} b\nc \\end{x} d\n',
  "an environment on a paragraph's second line":
    'first\nsecond \\begin{x} y\n- z \\end{x} w\n',
  'an environment starting an indented paragraph line':
    'a\n        \\begin{x}y\\end{x} b\n',
  'a paragraph line one tab stop deep': '    a \\begin{x}y\\end{x} b\n',
  'two environments mid-line':
    'a \\begin{x}y\\end{x} b \\begin{z}w\n\\end{z} c\n',
  'two environments mid-line, a space between':
    'a \\begin{x}y\\end{x} \\begin{z}w\\end{z} c\n',
  'an environment in a heading': '# Head \\begin{x}y\\end{x} tail\n',
  'an environment never ended in a heading': '# Head \\begin{x}y\n',
  'a setext heading after a mid-line environment':
    'a \\begin{x}y\\end{x} b\n===\n',
  'a mid-line environment under a command line':
    '\\newpage\na \\begin{x}y\\end{x} b\n',
  'a command line under a mid-line environment':
    'a \\begin{x} b\n\\end{x}\n\\newpage\n',
  'an environment under a mid-line environment':
    'a \\begin{x}y\\end{x}\n\\begin{z}w\\end{z} b\n',
  'a mid-line environment across a blank line in emphasis':
    '*a \\begin{x} b\n\nc \\end{x} d*\n',
  'a mid-line environment never ended': 'a \\begin{x} never\n',
  'a mid-line environment in a code span': 'a `\\begin{x}` b \\end{x}\n',
  'a code span across lines holding an environment':
    'a ` \\begin{x} b\nc ` \\end{x} d\n',
  'a code span broken by a blank line': 'a `b\n\nc` \\begin{x}y\\end{x} d\n',
  'an escaped mid-line environment': 'a \\\\begin{x} b \\end{x} c\n',
  'a mid-line environment in math': 'a $\\begin{x}y\\end{x}$ b\n',
  'a mid-line environment in an HTML comment':
    'a <!-- \\begin{x}y\\end{x} --> b\n',
  'a mid-line environment in an HTML comment across a blank line':
    'a <!-- b \\begin{x}y\\end{x}\n\n--> c\n',
  "a mid-line environment in a command's argument":
    'a \\footnote{\\begin{x}y\\end{x}} b\n',
  'a mid-line environment in an autolink':
    'a <http://x.y/\\begin{x}y\\end{x}> b\n',

  // Balanced brackets keep an environment inside them from ending the
  // paragraph, link or not.
  'an environment in link text': '[a \\begin{x}y\\end{x}](u)\n',
  'an environment in a link destination': '[a](u \\begin{x}y\\end{x}) b\n',
  'an environment in brackets': '[not a link \\begin{x}y\\end{x}] b\n',
  'an environment in nested brackets': '[a [b] \\begin{x}y\\end{x}] c\n',
  'an environment in brackets across lines': '[a\nb \\begin{x}y\\end{x}] c\n',
  'an environment starting a line in brackets': '[a\n\\begin{x}y\\end{x}] c\n',
  'an environment ending past its brackets': '[a \\begin{x} b] c \\end{x} d\n',
  'an environment in an inline note': 'a^[b \\begin{x}y\\end{x} c] d\n',
  'a bracket beside a code span holding one': '[a `]` \\begin{x}y\\end{x}] c\n',
  'a link destination closed past a blank line':
    'a [b](u\n\n\\begin{x}y\\end{x}) c\n',
  'a bracket closed past a blank line': '[a \\begin{x} b\n\nc \\end{x}] d\n',
  'a bracket opened inside the environment': 'a \\begin{x} [b \\end{x}] c\n',
  'an escaped bracket': 'a \\[ \\begin{x}y\\end{x} b\n',
  'a stray closing bracket': 'a ] \\begin{x}y\\end{x} b\n',
  'a bracket in a code span': 'a `[` \\begin{x}y\\end{x} ] c\n',
  'brackets before it': 'a [b] \\begin{x}y\\end{x} c\n',
  'a space between brackets and parentheses': '[a] (u \\begin{x}y\\end{x}) b\n',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on the raw TeX (tab stop ${tabStop})`, () => {
      assert.deepEqual(recognizerRaw(text, tabStop), pandocRaw(text, tabStop));
    });
    test(`${name}: no block opens inside raw TeX (tab stop ${tabStop})`, () => {
      assert.deepEqual(openedInside(text, tabStop), []);
    });
  }
}
