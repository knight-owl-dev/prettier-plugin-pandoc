// How far a block command reads, as `tex-arguments.js` has Pandoc's parsers.
//
// Each block command in each shape of arguments: the recognizer's raw TeX must
// be Pandoc's, none where Pandoc reads a paragraph.

// cspell:disable

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { BLOCK_COMMANDS } from '../src/tex-names.js';
import { rawBlocksOf, readPandocEach } from './helpers/pandoc.js';

const SHAPES = {
  'groups on its line': (c) => `\\${c}{a}{b}{c}{d}{e}{f} z`,
  'a word after it': (c) => `\\${c} z`,
  'nothing after it': (c) => `\\${c}`,
  'a group on the next line': (c) => `\\${c}\n{a} z`,
  'a group past a blank line': (c) => `\\${c}\n\n{a} z`,
  'a group past a comment': (c) => `\\${c} % c\n{a} z`,
  'a group past two comment lines': (c) => `\\${c} % c\n% d\n{a} z`,
  'an option and a group': (c) => `\\${c}[o]{a} z`,
  'a group after an option on the next line': (c) => `\\${c}[o]\n{a} z`,
  'a second group on the next line': (c) => `\\${c}{a}\n{b} z`,
  'a star and a group on the next line': (c) => `\\${c}*\n{a} z`,
  'an overlay': (c) => `\\${c}<2>{a} z`,
  'a dimension': (c) => `\\${c} 1em z`,
  'a command as its argument': (c) => `\\${c}\\foo{a} z`,
  'punctuation after its group': (c) => `\\${c}{a}. z`,
  'a label on the next line': (c) => `\\${c}{a}\n\\label{b} z`,
  'three groups, the last two on the next line': (c) => `\\${c}{a}\n{b}{c} z`,
};

// Arguments whose own content decides: what each parser rejects inside, what
// the preamble skips, and the document, after which Pandoc skips the rest.
const EDGES = [
  '\\documentclass{article}\n% \\begin{document}\n* a\n\n\\begin{document}\nx',
  '\\documentclass{article}\n\\newcommand{\\x}{\\begin{document}}\n* a\n\n\\begin{document}\nx',
  '\\documentclass{article}\n\\usepackage{x}\n\n* a\n\n\\begin{document}\nx\n\\end{document}',
  '\\clearpage .5em{a\n\n* b}',
  '\\section{a\n\nb}',
  '\\date{a\n\nb}',
  '\\section{a \\end{x}}',
  '\\blockcquote{a~b}{q}',
  '\\blockcquote{a\\foo}{q}',
  '\\blockcquote[p]{key, other}{q}. z',
  '\\lstinputlisting[a.b=1]{f}',
  '\\inputminted[a.b]{x}{y}',
  '\\lstinputlisting[language=C, firstline=2]{f} z',
  '\\date\\section{x}',
  '\\rule\\section{x}{y} z',
  '\\date\\foo*{x}',
  '\\address\nz',
  '\\begin{document}\nx\n\\end{document}\n\ntext after',
  'a\n\n\\begin{document}x\\end{document} y\n\nb',
];

const cases = [
  ...[...BLOCK_COMMANDS].flatMap((name) =>
    Object.entries(SHAPES).map(([shape, of]) => ({
      title: `\\${name} with ${shape}`,
      text: `${of(name)}\n`,
    })),
  ),
  ...EDGES.map((text) => ({ title: JSON.stringify(text), text: `${text}\n` })),
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
