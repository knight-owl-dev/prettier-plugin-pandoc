// A block inside an inline command's argument, as `tex-arguments.js` has
// Pandoc read each.
//
// Pandoc reads an argument of most inline commands as inlines: a block there
// fails the command, which stays text, and the block ends the paragraph. An
// argument it reads raw holds any block. Each inline command with a block in
// each of its first groups: the recognizer's raw TeX must be Pandoc's.

// cspell:disable

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { INLINE_COMMANDS, INLINE_ENVIRONMENTS } from '../src/tex-names.js';
import { rawBlocksOf, readPandocEach } from './helpers/pandoc.js';

const SHAPES = {
  'a block after it': (c) => `a \\${c} \\section{x} b`,
  'a block in its first group': (c) => `a \\${c}{\\section{x}} b`,
  'a block in its second group': (c) => `a \\${c}{u}{\\section{x}} b`,
  'a block in its third group': (c) => `a \\${c}{u}{v}{\\section{x}} b`,
  'an environment in its first group': (c) => `a \\${c}{\\begin{y}z\\end{y}} b`,
  'an environment in its second group': (c) =>
    `a \\${c}{u}{\\begin{y}z\\end{y}} b`,
  'blocks in its first two groups': (c) =>
    `a \\${c}{\\begin{y}z\\end{y}}{\\section{x}} b`,
};

// Commands within commands, brackets, which hold a block in markdown but not
// in an argument, and arguments missing: one of inlines takes the next token.
const EDGES = [
  'a \\emph{b \\emph{\\begin{x}y\\end{x}} c} d',
  'a \\emph{\\url{\\section{x}}} b',
  'a \\href{u}{[\\section{x}]} b',
  'a \\emph{[\\section{x}]} b',
  'a \\textcolor{red}{\\section{x}} b',
  '\\textcolor{red}{\\section{x}} b',
  'a \\vadjust \\section{x} b',
  '> a \\emph{\\section{x}} b',
  '- a \\href{u}{\\section{x}} b',
  'a \\href{\\section{x}} b',
  'a \\href{\\section{x}}',
  'a \\SIrange{\\begin{y}z\\end{y}}{u} b',
  'a \\mintinline{\\begin{y}z\\end{y}} b',
  'a \\href{\\section{x}}{\\textcolor{red}{y}} b',
  'a \\foreignlanguage{\\section{x}}{\\colorbox{red}{y}} b',
  // Nested failing commands, each read once: twice per level would hang.
  `a ${'\\href{u}{'.repeat(40)}\\section{x}${'}'.repeat(40)} b`,
];

// Pandoc's math environments are inline text: at a line start, in a
// paragraph, in an argument, in a colored command.
const ENVIRONMENTS = [...INLINE_ENVIRONMENTS].flatMap((name) => {
  const env = `\\begin{${name}}x\\end{${name}}`;
  return [env, `a ${env} b`, `a \\emph{${env}} b`, `\\textcolor{red}{${env}}`];
});

const cases = [
  ...[...INLINE_COMMANDS].flatMap((name) =>
    Object.entries(SHAPES).map(([shape, of]) => ({
      title: `\\${name} with ${shape}`,
      text: `${of(name)}\n`,
    })),
  ),
  ...[...EDGES, ...ENVIRONMENTS].map((text) => ({
    title: JSON.stringify(text),
    text: `${text}\n`,
  })),
];

const read = await readPandocEach(cases.map((c) => c.text));

cases.forEach(({ title, text }, i) => {
  test(title, () => {
    const recognized = blocks(text)
      .filter((block) => block.type === 'raw-tex')
      .map((block) => text.slice(block.start, block.end));
    assert.deepEqual(recognized, rawBlocksOf(read[i]));
  });
});
