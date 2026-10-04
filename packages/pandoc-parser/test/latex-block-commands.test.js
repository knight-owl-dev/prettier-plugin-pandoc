// Block commands in LaTeX, read as Pandoc reads them, with raw TeX off
// and on and macros on and off.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex', '-latex_macros'];

const CASES = {
  sections:
    '\\section{Intro} text \\subsection*{Star} \\subsubsection{Deep}\\label{d} \\ref{d}\n\n\\paragraph{P} \\subparagraph{SP} \\minisec{M}',
  'chapters and numbering':
    '\\chapter{One}\\section{A}\\section{A}\\chapter{Two}\\section[short]{B}',
  parts: '\\part{P}\\section{S}',
  'title and authors':
    '\\title{The Title}\\author{A. One \\and B. Two}\\date{2024}\\subtitle{Sub}\\dedication{D}\ntext \\maketitle',
  'title of blocks': '\\title{{\\bf Bold} title}\\author{Solo}',
  letters: '\\opening{Dear X,} Body. \\closing{Regards}\n\\signature{Me}',
  'letters with an author': '\\author{A}\\opening{Hi} \\closing{Bye}',
  'paragraph breaks and rules':
    'a \\par b\n\n\\hrule \\rule{0pt}{2pt} \\rule{1cm}{2pt} \\rule[1pt]{0.0in}{1pt} \\plainbreak{x} \\pfbreak \\strut \\raggedright',
  'centerline, caption and loose items':
    '\\centerline{ Centered } \\caption{Cap} \\item x',
  bibliography: '\\bibliography{refs, more.bib} \\addbibresource{x.bib}',
  hypertargets:
    '\\hypertarget{h1}{\\section{Head}} \\hypertarget{x}{\\section{Other}} \\hypertarget{y}{Para}',
  'colored blocks': '\\textcolor{red}{\\section{S}} \\colorbox{blue}{x}',
  'epigraph and package errors':
    '\\epigraph{Quote}{Source} \\PackageError{a}{b}{c} after',
  parbox: '\\parbox[t]{5cm}{Inside}',
  preamble:
    '\\documentclass[12pt]{article}\n\\newcommand{\\foo}{bar}\n\\begin{filecontents}{x.tex}\nhello\n\\end{filecontents}\n\\title{T}\n\\foo',
  endinput: 'before \\endinput after',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const ext of VARIANTS) {
    test(`${name}: Pandoc's AST (latex${ext})`, () => {
      const extensions = ext.match(/[+-][a-z_]+/g) ?? [];
      assert.deepEqual(
        withoutSpans(readLaTeX(text, { extensions })),
        pandocLaTeXAst(text, ext),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    for (const ext of VARIANTS) {
      const extensions = ext.match(/[+-][a-z_]+/g) ?? [];
      const { blocks } = readLaTeX(text, { extensions });
      assertNested(blocks, 0, text.length, `latex${ext}`);
    }
  });
}

test('metadata keys in order, as Pandoc writes them', () => {
  const { meta } = readLaTeX('\\title{T}\\date{D}\\author{A}');
  assert.deepEqual(Object.keys(meta), ['author', 'date', 'title']);
});
