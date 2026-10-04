// LaTeX read as Pandoc's LaTeX reader reads it, with raw TeX off and on and
// macros on and off; spans in order, each within its parent's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex', '-latex_macros', '+raw_tex-latex_macros'];

const CASES = {
  paragraphs: 'Hello  world.\nNext line.\n\n\n Second  paragraph.\n',
  'dashes, quotes and ties':
    "a - b -- c --- d, ``double'' `single' it's \"`babel\"' “curly” ‘s’ x~y ''",
  'quotes left open': "``open and `open, then 'apostrophe' ok`'",
  'special characters': 'a # b & c _ d ^ e | f ^^41^^7a',
  comments: 'a % comment\nb%\nc\n%only\n\nd',
  groups: 'A {group} and {} and {{nested}} {\\bgroup x\\egroup}.',
  math: 'Math $x^2$, $$y$$, \\(a\\), \\[b\\], \\ensuremath{c}, $a{b}$, $\\$x$.',
  'math left open': 'a $$ b',
  'math environments':
    '\\begin{equation}\nx = 1\n\\end{equation}\n\\begin{align*}a&b\\\\c&d\\end{align*} and \\begin{math}m\\end{math}\n\\begin{dgroup}d\\end{dgroup}',
  'unknown commands':
    '\\unknown{arg} and \\foo[opt]{x}{y} \\qux*{z} \\baz<2>{w} \\noindent text \\index{i}',
  'block commands':
    '\\vspace{1em}\n\n\\maketitle\n\\clearpage text\n\n\\foo{a}\\qux{b}\n\nafter',
  'unknown environments':
    '\\begin{foo}[o]\nbody \\qcolor\n\\end{foo}\n\n\\begin{bar}a}b\\end{bar}',
  'macros defined and used':
    '\\newcommand{\\foo}{bar}\\newcommand\\two[2]{#2-#1}\\newcommand{\\opt}[2][d]{(#1,#2)}\n\\foo{} baz \\foo \\two{a}{b} \\opt{x} \\opt[y]{z}',
  'macros redefined':
    '\\newcommand{\\x}{A}\\newcommand{\\x}{B}\\x \\renewcommand{\\x}{C}\\x \\providecommand{\\x}{D}\\x \\providecommand{\\y}{E}\\y',
  'def, let and edef':
    '\\def\\x#1{<#1>}\\x{a} \\x b \\def\\y#1.{(#1)}\\y z. \\let\\z\\x\\z{c} \\edef\\w{\\x{d}}\\w \\let\\q=a\\q',
  'global definitions': '{\\def\\x{L}\\gdef\\y{G}\\global\\def\\z{Z}}\\x\\y\\z',
  conditionals:
    '\\iftrue yes\\else no\\fi \\iffalse A\\else B\\fi \\newif\\iffoo \\iffoo T\\else F\\fi \\footrue \\iffoo T\\else F\\fi',
  'environments defined':
    '\\newenvironment{e}[1]{[#1:}{]}\n\\begin{e}{x}body\\end{e}\n\n\\DeclareMathOperator{\\op}{op}$\\op x$',
  'number of arguments':
    '\\newcommand{\\qa}[ 2 ]{#1#2}\\qa xy \\newcommand{\\qb}[(1)]{#1}\\qb z \\newcommand{\\qc}[0x2]{#2#1}\\qc pq \\newcommand{\\qd}[-1]{<#1>}\\qd',
  theorems:
    '\\newtheorem{thm}{Theorem}\\newtheorem{lem}[thm]{Lemma}\\theoremstyle{definition}\\newtheorem*{defn}{Definition}\\theoremstyle{remark}\\newtheorem{rem}{Remark}[thm]\n\\begin{thm}\nA claim.\n\n\\end{thm}\n\\begin{lem}[Note]\n$x$ holds.\n\\end{lem}\n\\begin{defn}Def.\\end{defn}\n\\begin{rem}\n\\vspace{1em}\n\nR.\n\\end{rem}',
  proofs:
    '\\begin{proof}\nEasy.\n\\end{proof}\n\\begin{proof}[Sketch]\n$x$\n\n\\begin{foo}y\\end{foo}\n\\end{proof}',
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

test('spans: a paragraph runs from its first inline to its last', () => {
  const text = '  a {b} $c$\n\nd\n';
  const [p, q] = readLaTeX(text).blocks;
  assert.deepEqual(
    [p, q].map((b) => text.slice(b.start, b.end)),
    ['a {b} $c$', 'd'],
  );
  assert.deepEqual(
    p.c.map((x) => text.slice(x.start, x.end)),
    ['a', ' ', '{b}', ' ', '$c$'],
  );
});

test('spans: a macro expansion spans nothing, where the macro starts', () => {
  const text = '\\def\\x{a b}x \\x{} y';
  const [{ c: inlines }] = readLaTeX(text).blocks;
  assert.deepEqual(
    inlines.map((x) => [x.t, x.start, x.end]),
    [
      ['Str', 11, 12],
      ['Space', 12, 13],
      ['Str', 13, 13],
      ['Space', 13, 13],
      ['Str', 13, 13],
      ['Space', 17, 18],
      ['Str', 18, 19],
    ],
  );
});

test('spans: raw TeX and environments run from their commands', () => {
  const text = 'a \\foo[o]{x} b\n\n\\begin{bar}\nc\n\\end{bar}\n';
  const [p, env] = readLaTeX(text, { extensions: ['+raw_tex'] }).blocks;
  assert.equal(text.slice(p.c[2].start, p.c[2].end), '\\foo[o]{x}');
  assert.equal(text.slice(env.start, env.end), '\\begin{bar}\nc\n\\end{bar}');
});

test('a document Pandoc fails to read fails', () => {
  assert.throws(() => readLaTeX('a } b'), /the LaTeX reader failed/);
});
