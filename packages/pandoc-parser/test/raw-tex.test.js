// Raw TeX in Markdown, read as Pandoc reads it through its LaTeX reader:
// where it ends, tokenizer drifts included, and macros defined and
// applied.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const CASES = {
  'commands and their arguments':
    'a \\foo{x}{y}[z] b\n\na \\foo[x]\nbar\n\n\\foo2 \\qux 3 apples \\baz 1.5em \\hskip 3pt plus 1fil\n\na \\foo\tb',
  'blocks among paragraphs':
    'a \\section{x} b\n\na \\write18{x} \\titleformat{a}[b]{c}{d}{e}{f} g\n\n\\foo{a}\nbar\n\n\\foo{a}\\hspace{1em}\n\n\\foo{a}\\textbf{x}\n\n\\cite{a}',
  'groups and blank lines':
    'a \\emph{x\n\ny} b\n\na \\foo{x\n\ny} b\n\na \\emph\n\n{x} b\n\na \\emph xyz',
  'not raw': 'a \\cite{a\\_b} c, a \\emph{#1} b, \\textbf{a $b}$ c}',
  citations: 'a \\cite[p.~3]{a, b} c \\citep*{x}',
  'documents to the end':
    '\\begin{document}\nfoo\n\\end{document}\n\nmore text',
  'a preamble': '\\documentclass{article}\nfoo\n\nbar\n\\begin{document}\nx',
  endinput: 'x\n\n\\endinput\n\nmore\n\nstuff',
  environments:
    '\\begin{center}\n}\n\\end{center}\n\n\\begin{center}}\\end{center}\n\n\\begin{foo}\n}\n\\end{foo} tail\n\n\\begin{foo}\\begin{foo}x\\end{foo}\\end{foo} tail\n\n\\begin{comment}\n\\end{verbatim}\n\\end{comment}\n\n\\begin{description}\n\\item foo\n\\end{description}\n\na \\begin{equation}x\\end{equation} b',
  'macro definitions':
    '\\newcommand{\\x}{y} rest\n\n\\x and $\\x$ and $$\\x$$\n\n\\def\\z#1{<#1>} \\z{q}',
  'definitions that stay text':
    '\\def\\x#1 #2{z}\n\n\\newcommand\n\\x{y}\n\na \\global\\advance b',
  makeatletter: '\\makeatletter\n\\def\\a@b{c}\n\\makeatother\nrest',
  'drifts: a url with a comment':
    'l1\n\nl2\n\nl3\n\nl4\n\na \\url{a%b} c\n\nl6\n\nl7\n\nl8\n\nl9\n\nl10',
  'drifts: ## and line ends':
    'a \\foo{##} b\n\na \\foo{x\\\ny} b\n\na \\foo{^^\nx} b\n\na \\foo{x\\   \n\nz} b',
  'special macros':
    'a \\expandafter\\foo b\n\na \\iffalse b c\n\na \\iftrue x\\else y\\fi z, a \\xspace b\n\na \\foo{\\iffalse}\\fi} b',
  'groups and final braces':
    'a \\bgroup x y\\egroup{} z\n\na \\LaTeX{}{} b \\ldots{} c',
  verbatim: '\\verb|x|\n\n\\verb|x\ny|',
  'stars and overlays':
    'a \\foo*\n{a} b\n\na \\foo<2->{x} \\bar<presentation>{y} \\baz<abc>{z}\n\na \\small b \\tiny{c}',
  'loose block commands':
    '\\item foo\n\n\\hspace{1em} text\n\n\\input{a}{b}\n\n\\textcolor{red}{x}\n\n\\textcolor{red}{x\n\ny}\n\n\\section{x}\n\n\\label{y} z',
  'ConTeXt environments':
    '\\startitemize\n\\item a\n\\stopitemize\n\ntext \\starttext x \\stoptext more\n\n\\start[x y]z\\stop[x y]',
  'in lists, quotes and links':
    '- \\foo{a}\n- b \\emph{c}\n\n> \\begin{x}\n> y\n> \\end{x}\n\n[a \\foo{]} b](u) and [\\cite{k}][r]\n\n[r]: v',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: Pandoc's AST (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        withoutSpans(readMarkdown(text, { tabStop })),
        pandocAst(text, tabStop),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readMarkdown(text).blocks, 0, text.length, 'document');
  });
}

test('spans: raw TeX runs from its backslash to where it ends', () => {
  const text = 'a \\foo{x}{y}[z] b\n\n\\begin{x}\ny\n\\end{x}\n';
  const [p, raw] = readMarkdown(text).blocks;
  assert.equal(text.slice(p.c[2].start, p.c[2].end), '\\foo{x}{y}');
  assert.equal(text.slice(raw.start, raw.end), '\\begin{x}\ny\n\\end{x}');
});
