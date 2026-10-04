// Citations in LaTeX, read as Pandoc reads them, with raw TeX off and on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex'];

const CASES = {
  'cite and natbib':
    '\\cite{a} \\cite[p.~3]{a,b} \\cite[see][p.~3]{a} \\citep*{x} \\citet{y} \\citeyear{z} \\textcite{t}',
  'biblatex and notes':
    '\\autocite{a} \\footcite{f} \\footcite[p.~1]{g} \\parencite*{p} \\supercite{s}',
  multicites:
    '\\cites{a}{b} \\cites(pre)(post)[p1]{a}[p2]{b} \\textcites[see][]{a}{b} \\footcites(x){a}{b} \\autocites(only){a}{b}',
  'citetext and citeauthor':
    '\\citetext{see \\citealp{a}; also \\citealp[p.~2]{b}} and \\citeauthor{c} and \\citeauthor{x}\\citetext{\\citealp{d}}',
  'nocite into metadata': '\\nocite{a}\\nocite{b,c} text',
  'nocite all': '\\nocite{*}',
  'block quotes':
    '\\blockquote{A quote.}\n\n\\blockquote[Author]{With text.}\n\n\\blockcquote[p.~5]{key}{With cite.}.\n\n\\foreignblockquote{french}{Bonjour.}\n\n\\hyphenblockcquote{german}[s]{k}{Hallo}',
  keys: '\\cite{ a , b }  \\cite[{x}]{k} \\cite{k:1-2_3}',
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
