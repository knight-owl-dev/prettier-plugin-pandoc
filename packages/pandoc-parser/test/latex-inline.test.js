// Inline commands in LaTeX, read as Pandoc reads them, with raw TeX off
// and on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex'];

const CASES = {
  'fonts and styles':
    "\\emph{ a b } \\textit{x} \\textbf{y}\\textsc{z} \\textsf{s} \\texttt{t--t ``q''} \\alert<2>{al} \\textsuperscript{2}\\textsubscript{i} \\textnormal{n} \\underline{u}",
  'boxes, lettrines and PDF strings':
    '\\mbox{a b\\\\c} \\hbox{h} \\vbox{v} \\lettrine[x]{L}{orem} \\texorpdfstring{A}{B}',
  'old TeX commands':
    '{\\em a b} {\\it c} {\\bf d} {\\tt e f} {\\rm g} {\\itshape h} {\\scshape i} {\\bfseries j}',
  case: '\\MakeUppercase{straße x} \\MakeLowercase{ΣΑΣ Ab} \\uppercase{q}',
  'footnotes and labels in them':
    'a\\footnote{note \\label{fn} here}b \\ref{fn} \\thanks[x]{t}',
  'footnote marks and texts':
    'a\\footnotemark{} b\\footnotetext{text} c\\footnotemark[5] d\\footnotetext[5]{five} e\\footnotemark[9]',
  'line breaks and passthrough': 'x\\newline y \\passthrough{\\texttt{a\\%b}}',
  links:
    '\\url{http://a.b/c\\_d#e} \\nolinkurl{x\\%y} \\href{http://z}{zed} \\hyperlink{t}{to t} \\hyperref[lab]{L} \\hyperref{u}{c}{n}{T} \\hypertarget{h}{H}',
  'hyphenat and colors':
    '\\nohyphens{n} \\textnhtt{a b} \\nhttfamily{c} \\textcolor{red}{r} \\colorbox[rgb]{1,0,0}{bg}',
  toggles:
    '\\newtoggle{t}\\toggletrue{t}\\iftoggle{t}{yes}{no} \\togglefalse{t}\\iftoggle{t}{yes}{no} \\iftoggle{u}{a}{b} c\n\n\\iftoggle{t}{Y}{N}\n\n\\iftoggle{v}{V}{W}\n\n\\}\\iftoggle{v}{V}{W}',
  'soul, ulem, ifdim':
    '\\st{s} \\ul{u} \\hl{ h } \\sout{o} \\uline{l} \\ifdim\\x>1pt big\\fi \\pandocbounded{p}',
  'verbatim and inline code':
    '\\verb!a\\!b! \\verb+x\\+y+ \\verb|a b| \\verb+x\\y+ \\Verb!q! \\lstinline[language=Python]{print(1)} \\lstinline|z| \\mintinline{c}{int x;} \\verb|a}|',
  'symbols and letters':
    '\\pounds\\euro \\textdegree \\aa\\AA\\ss\\o\\O\\L\\l\\ae\\AE\\oe\\OE\\i\\j',
  accents:
    "\\'e \\`a \\^o \\~n \\\"u \\c{c} \\v{s} \\H{o} \\k{a} \\={a} \\.{z} \\u{g} \\r{a} \\b{b} \\d{d} \\t{oo} \\'{} \\^ x \\textcircled{a} \\newtie{x} \\G{a}",
  characters:
    '\\ldots \\dots \\sim \\$ \\% \\& \\# \\_ \\{ \\} \\- \\qed \\lq\\rq \\textquoteleft \\/ a\\\\b \\, \\@ \\ \\ps x \\TeX\\ \\LaTeX \\bar \\slash \\faCheck \\bshyp \\glqq x\\grqq \\guillemetleft \\textquotedbl',
  biblatex:
    '\\RN{12} \\Rn{2024} \\RN 7 \\mkbibquote{q} \\mkbibemph{e} \\mkbibparens{p} \\mkbibbrackets{b} \\autocap{a} \\bibstring{and} \\adddot\\adddotspace\\addabbrvspace\\hyphen',
  references:
    '\\label{x} \\ref{x} \\cref{x} \\Cref{x} \\vref{x} \\eqref{x} \\autoref{x}',
  acronyms: '\\gls{api} \\Glspl{api} \\acf{x} \\acsp{y}',
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

test('spans: verbatim cut at its delimiter keeps the text after', () => {
  const text = '\\verb|a|b c';
  const [{ c: inlines }] = readLaTeX(text).blocks;
  assert.deepEqual(
    inlines.map((x) => text.slice(x.start, x.end)),
    ['\\verb|a|', 'b', ' ', 'c'],
  );
});
