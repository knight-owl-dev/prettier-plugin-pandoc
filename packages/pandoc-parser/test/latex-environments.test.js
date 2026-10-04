// Environments and tables in LaTeX, read as Pandoc reads them, with raw
// TeX off and on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex'];

const CASES = {
  document: '\\begin{document}\nHello \\emph{world}.\n\\end{document}\nignored',
  abstract: '\\begin{abstract}\nShort.\n\\end{abstract}\nBody.',
  itemize:
    '\\begin{itemize}\n\\item One\n\\item[x] Two\n\n  Para.\n\\end{itemize}',
  enumerate:
    '\\begin{enumerate}[(a)]\n\\item A\n\\item B\n\\end{enumerate}\n\\begin{enumerate}\n\\setcounter{enumi}{4}\n\\item Five\n\\end{enumerate}',
  description:
    '\\begin{description}\n\\item[Term] Def.\n\\item[Other] More.\n\\end{description}',
  'quotes and center':
    '\\begin{quote}Q\\end{quote}\\begin{quotation}QQ\\end{quotation}\\begin{verse}V\\end{verse}\\begin{center}C\\end{center}',
  minipage: '\\begin{minipage}[t]{0.5\\textwidth}\nMini.\n\\end{minipage}',
  'verbatim and listings':
    '\\begin{verbatim}\nx = 1\n  y\n\\end{verbatim}\n\\begin{Verbatim}[numbers=left,firstnumber=3]\ncode\n\\end{Verbatim}\n\\begin{lstlisting}[language=Python,label=lst]\nprint(1)\n\\end{lstlisting}\n\\begin{minted}[linenos=true]{c}\nint x;\n\\end{minted}\n\\begin{comment}\nhidden\n\\end{comment}',
  'alltt and obeylines':
    '\\begin{alltt}\na b\nc\n\\end{alltt}\n\\begin{obeylines}\nline one\nline two\n\\end{obeylines}',
  'figures and their labels':
    '\\begin{figure}[htb]\n\\centering\nText.\n\\caption{A figure}\\label{fig:a}\n\\end{figure}\nSee \\ref{fig:a}.',
  tabular:
    '\\begin{tabular}{lcr}\n\\hline\na & b & c \\\\\n\\hline\n1 & 2 & 3 \\\\\n4 & 5 & 6 \\\\\n\\hline\n\\end{tabular}',
  'table floats':
    '\\begin{table}\n\\caption{Cap}\\label{tab:x}\n\\begin{tabular}{|l|r|}\nx & y \\\\\n\\end{tabular}\n\\end{table}\n\\ref{tab:x}',
  'multicolumn and multirow':
    '\\begin{tabular}{*{3}{c}}\n\\multicolumn{2}{l}{wide} & z \\\\\n\\multirow{2}{*}{tall} & b & c \\\\\n & e & f \\\\\n\\end{tabular}',
  'longtable and booktabs':
    '\\begin{longtable}{ll}\n\\toprule\nH1 & H2 \\\\\n\\midrule\nr1 & r2 \\\\\n\\bottomrule\n\\caption{Long}\n\\end{longtable}',
  'tabularx and column specs':
    '\\begin{tabularx}{\\linewidth}{>{\\bfseries}l p{0.3\\linewidth} X}\na & b & c \\\\\n\\end{tabularx}',
  'raw environments': '\\begin{tikzpicture}\n\\draw (0,0);\n\\end{tikzpicture}',
  'a table that fails, read again as a raw environment':
    '\\begin{tabularx}{\\linewidth}{r}\n\\cmidrule(lr){1-2}\n$x$ & \\multicolumn{2}{c}{m} \\\\\n\\toprule\n\\end{tabularx}',
  letters:
    '\\begin{letter}{Address}\n\\opening{Dear}\nBody.\n\\closing{Bye}\n\\end{letter}',
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

test('spans: a table runs from its begin to its end', () => {
  const text = 'x\n\n\\begin{tabular}{l}\na \\\\\n\\end{tabular}\n';
  const [, table] = readLaTeX(text).blocks;
  assert.equal(
    text.slice(table.start, table.end),
    '\\begin{tabular}{l}\na \\\\\n\\end{tabular}',
  );
});
