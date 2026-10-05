// Random documents for the fuzzers, each kind from its own fragments. `r`
// is `random()` from `../lib/run.mjs`: a seed draws the same documents.

const BLOCKS = [
  'para text',
  'para *em*  ',
  '# Head',
  'Setext\n===',
  '- a\n- b',
  '1. one\n2. two',
  '- a\n\n  b',
  '    code',
  '```\nfenced\n```',
  '> quote\n> more',
  '> lazy\nline',
  '[r]: http://u',
  '[^n]: note\n\n    more',
  'see [r] and[^n]',
  '<div>\nx\n</div>',
  '<section>\nfoo\n</section>',
  '<!-- c -->',
  '\\begin{x}\ny\n\\end{x}',
  '\\newcommand{\\z}{Z}',
  '\\z here',
  '::: note\nbody\n:::',
  '| a |\n|---|\n| b |',
  'Term\n: def',
  '| verse\n|  two',
  '---\ntitle: T\n---',
  '* * *',
  '  indented',
  '\t\ttab',
  'Table: cap',
  '  a  b\n  -- --\n  1  2',
  '+--+\n|a |\n+--+',
  '(@) ex',
  'a\\\nb',
  '$$x$$',
  '<span>s</span>',
  '  - nested\n    - deeper',
  '% Title',
  '```yaml\na:   1\nb: [ x,y ]\n```',
  '```json\n{"a":1}\n```',
  '~~~ {.js}\nlet  x=1\n~~~',
  '````\n```\nnested\n```\n````',
  '```markdown\n*  item\n```',
  '```yaml\n: not yaml\n```',
  '``` lua\nlocal  x\n```',
  '<!-- prettier-ignore -->\n*keep*   as  written',
  '<!-- prettier-ignore-start -->\n* * *\n\n*x*\n<!-- prettier-ignore-end -->',
  '- - -',
  'line\t\nbreak',
  '<div class="x">\n\npara in a div\n\n</div>',
  '<div>\ntight in a div\n</div>',
  '<div>\n\nunclosed div',
];

// Words that open a block, or end a paragraph, at the start of a line.
const WORDS = [
  ...['word', 'text', 'a', 'longerword', ':', '~', '---', '===', '-', '+'],
  ...['*', '1.', '#', '>', '|', '```', '~~~', ':::', '</div>', '<div>'],
  ...['\\begin{x}', '\\end{x}', '\\newpage', 'Table:', '(@)', 'a)', '[^n]:'],
  ...['[r]:', '%', '*em', 'ph*', '`co', 'de`', '$x', 'y$', '"q', "it's"],
  ...['---|---', '|a|', '+--+', '--', '-----', '\\', 'x\\', '<!--', '-->'],
  ...['*x*', '_y_', '__s__', '**t**', 'a*b*c', '***u***', '*a', 'b*', '_c'],
  ...['[a long link text](http://u)', '[two\nlines](u)', '![alt text](i.png)'],
  ...['[x *y* z](u "a title")', '<http://auto.link>', '[ref link][r]'],
];

const prose = ({ below, pick }) =>
  Array.from({ length: 3 + below(30) }, () => pick(WORDS)).join(
    pick([' ', ' ', ' ', '\n', '  \n']),
  );

const indent = (text, prefix) =>
  text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');

function nested(r, depth = 0) {
  const { below, pick } = r;
  const inner = depth < 2 && below(3) === 0 ? nested(r, depth + 1) : prose(r);
  switch (below(7)) {
    case 0:
      return indent(inner, pick(['> ', '>']));
    case 1: {
      const marker = pick(['- ', '* ', '1. ', 'a) ', '(@) ', '-\t', '-   ']);
      const width = marker.replace('\t', '    ').length;
      const more = below(2) ? `\n${marker}${prose(r)}` : '';
      return marker + indent(inner, ' '.repeat(width)).trimStart() + more;
    }
    case 2: {
      const marker = pick([':   ', ': ', '~ ']);
      return `Term\n${marker}${indent(inner, '    ').trimStart()}`;
    }
    case 3:
      return below(2) ? `::: d\n${inner}\n:::` : `<div>\n\n${inner}\n\n</div>`;
    case 4:
      return `- ${prose(r)}\n\n  ${indent(inner, '  ').trimStart()}`;
    case 5:
      return `> ${prose(r)}\n${prose(r)}`;
    default:
      return `${pick(['- ', '1. '])}${prose(r)}\n${prose(r)}`;
  }
}

const SEPARATORS = ['\n', '\n\n', '\n\n\n', '  \n\n', '\n \n', '\n\t\n\n'];
const ENDINGS = ['', '\n', '\n\n', '  '];

/**
 * Markdown blocks, prose of words that open blocks at a line start, and
 * nested containers, between random blank lines and trailing spaces.
 *
 * @param {ReturnType<typeof import('../lib/run.mjs').random>} r
 */
export function markdown(r) {
  const { below, pick } = r;
  const blocks = 1 + below(7);
  let doc = below(4) === 0 ? pick(['\n', '\n\n', ' ']) : '';
  for (let k = 0; k < blocks; k++) {
    doc += [prose, () => pick(BLOCKS), nested][below(3)](r);
    doc += k < blocks - 1 ? pick(SEPARATORS) : pick(ENDINGS);
  }
  return doc;
}

const PREFIXES = [
  '> ',
  '>',
  '- ',
  '-\t',
  '1. ',
  '  ',
  '\t',
  ':   ',
  '    ',
  '',
];
const LINES = [
  ...['text', 'more text', '', '    code', '\tcode', '- item', '> quote'],
  ...['```', '~~~', 'Term', ':   def', '\\begin{x}', '\\end{x}', '<div>'],
  ...['</div>', '::: d', ':::', '| a |', '|---|', 'a[^n] b', '[^n]: a note'],
];

/**
 * Lines behind random container prefixes, tabs among them: nesting the
 * reader extracts contents from.
 *
 * @param {ReturnType<typeof import('../lib/run.mjs').random>} r
 */
export function containers({ below, pick }) {
  const line = () =>
    Array.from({ length: below(3) }, () => pick(PREFIXES)).join('') +
    pick(LINES);
  return `${Array.from({ length: 2 + below(10) }, line).join('\n')}\n`;
}

const TEX_IN_MARKDOWN = [
  ...['|', '| ', ' |', '|---|', '|:--|', '|--:|', '-----', ':-:', '+'],
  ...['\n| a | b |\n|---|---|\n', '| x |\n', '\n|---|\n', 'Table: c\n\n'],
  ...['\\|', 'text', 'more words', '*em*', '`code`', '$x^2$', '$$y$$'],
  ...['[link](u)', '[^n]', '[a]', '> ', '- ', '1. ', '# ', '\n', '\n\n'],
  ...['  ', ' ', '\\foo', '\\foo{a}', '\\foo[o]{a}{b}', '\\emph{e}'],
  ...['\\textbf{b}', '\\section{S}', '\\label{l}', '\\ref{l}', '\\cite{k}'],
  ...['\\begin{x}', '\\end{x}', '\\begin{x}y\\end{x}'],
  '\\begin{itemize}\n\\item a\n\\end{itemize}',
  '\\begin{equation}a\\end{equation}',
  ...['\\newcommand{\\x}{X}', '\\newcommand\\y[1]{<#1>}', '\\x', '\\y{z}'],
  ...['\\def\\z{Z}', '\\z', '$\\x$', '\\renewcommand{\\x}{R}'],
  ...['\\iftrue T\\fi', '\\iffalse F\\fi', '\\makeatletter', '\\makeatother'],
  ...['\\input{a}', '\\usepackage{p}', '\\vspace{1em}', '\\noindent'],
  ...['\\startitemize', '\\stopitemize', '\\starttext x \\stoptext'],
  ...['\\\\', '\\ ', '\\%', '\\{', '\\$', '\\[a\\]', '\\(b\\)'],
  ...['{', '}', '[', ']', '%c', '#', '&', '~', '^^41', '\\verb|v|'],
  ...['\\url{http://x}', '\\x{}', '{}', '\\begin{document}', '\\foo\n\n'],
  '\\begin{tabular}{l}\na\\\\\n\\end{tabular}',
  ...['\\documentclass{article}', '\\endinput', '\\footnote{f}'],
];

/**
 * Markdown rich in raw TeX, macros and pipe-table pieces; a paragraph's
 * word first, so no title block opens it.
 *
 * @param {ReturnType<typeof import('../lib/run.mjs').random>} r
 */
export function rawTex({ below, pick }) {
  const parts = Array.from({ length: 2 + below(9) }, () =>
    pick(TEX_IN_MARKDOWN),
  );
  return `p ${parts.join('')}\n`;
}

const LATEX = [
  ...['a', 'word', ' ', '  ', '\n', '\n\n', '%c\n', '{', '}', '{x}', '$', '$$'],
  ...['x^2', '\\(', '\\)', '\\[', '\\]', '-', '--', '---', "'", "''", '`'],
  ...['``', '"', '"`', '"\'', '“', '”', '‘', '’', '~', '#', '&', '_', '^'],
  ...['^^41', '^^z', '\\foo', '\\foo{a}', '\\foo[o]{a}', '\\qux*', '\\x'],
  ...['\\y', '\\vspace{1em}', '\\maketitle', '\\noindent', '\\index{i}'],
  ...['\\newcommand{\\x}{X}', '\\newcommand\\y[1]{<#1>}'],
  ...['\\newcommand{\\z}[2][d]{#1-#2}', '\\renewcommand{\\x}{R}'],
  ...['\\providecommand{\\x}{P}', '\\def\\x{D}', '\\def\\y#1.{(#1)}'],
  ...[
    '\\gdef\\x{G}',
    '\\global\\def\\x{GG}',
    '\\let\\y\\x',
    '\\edef\\x{\\x\\x}',
  ],
  ...['\\newif\\ifq', '\\qtrue', '\\ifq T\\else F\\fi', '\\iftrue I\\fi'],
  ...['\\iffalse N\\fi', '\\newenvironment{e}{[}{]}', '\\begin{e}', '\\end{e}'],
  ...['\\begin{foo}', '\\end{foo}', '\\begin{equation}', '\\end{equation}'],
  ...['\\begin{align*}', '\\end{align*}', '\\ensuremath{y}', '\\op'],
  ...['\\DeclareMathOperator{\\op}{op}', '\\newtheorem{thm}{Theorem}'],
  ...['\\newtheorem*{rem}{Remark}', '\\theoremstyle{remark}', '\\begin{thm}'],
  ...['\\end{thm}', '\\begin{rem}[N]', '\\end{rem}', '\\begin{proof}'],
  ...['\\end{proof}', '[opt]', '\\bgroup', '\\egroup', '\\proofname'],
  ...['\\setdefaultlanguage{french}', '\\figurename', '\\enquote{q}'],
  ...['\\setmainlanguage[variant=british]{english}', '\\enquote*{'],
  ...['\\foreignlanguage{german}{x}', '\\textfrench{ y }', '\\begin{german}'],
  ...['\\textgerman[variant=swiss]', '\\end{german}', '\\end{otherlanguage}'],
  ...['\\begin{otherlanguage}{french}', '\\foreignquote{french}{z}'],
  ...['\\emph{', '\\textbf{b}', '\\texttt{t}', '\\em ', '\\verb|v|'],
  ...['\\verb!a\\!', '\\lstinline{c}', "\\'e", '\\"{u}', '\\c ', '\\%', '\\{'],
  ...[
    '\\}',
    '\\\\',
    '\\ ',
    '\\,',
    '\\ldots',
    '\\footnote{f}',
    '\\footnotemark',
  ],
  ...[
    '\\footnotetext{t}',
    '\\label{l}',
    '\\ref{l}',
    '\\url{u}',
    '\\href{h}{H}',
  ],
  ...['\\MakeUppercase{m}', '\\mbox{x y}', '\\newtoggle{t}', '\\gls{g}'],
  ...[
    '\\iftoggle{t}{Y}{N}',
    '\\toggletrue{t}',
    '\\RN{4}',
    '\\textcolor{red}{r}',
  ],
  ...['\\hyperref[l]{h}', '\\ifdim', '\\fi', '\\thanks{t}', '\\cite{k}'],
  ...['\\cite[p]{k,l}', '\\citep[a][b]{k}', '\\textcite{t}', '\\footcite{f}'],
  ...['\\cites(x)(y)[a]{k}[b]{l}', '\\citetext{', '\\citeauthor{a}'],
  ...['\\nocite{n}', '\\blockquote{q}', '\\blockcquote[p]{k}{c}', ';'],
  ...['\\foreignblockquote{french}{f}', '\\citealp{c}', '\\num{1.5e3}'],
  ...['\\num{1(2)}', '\\si{\\metre\\per\\second}', '\\SI{1}[\\$]{}'],
  ...['\\SI{3}{\\kilo\\gram}', '\\SIrange{1}{2}{\\ms}', '\\SIlist{1;2}{\\s}'],
  ...['\\ang{1;2;3}', '\\numlist{1;2;3}', '\\si{\\square', '\\qty{'],
  ...['\\section{s}', '\\section*{t}', '\\chapter{c}', '\\part{p}'],
  ...['\\title{T}', '\\author{A \\and B}', '\\date{d}', '\\opening{o}'],
  ...[
    '\\closing{c}',
    '\\par',
    '\\hrule',
    '\\rule{0pt}{1pt}',
    '\\rule{1cm}{1pt}',
  ],
  ...['\\caption{c}', '\\item', '\\bibliography{b}', '\\hypertarget{h}{'],
  ...['\\textcolor{red}{', '\\epigraph{a}{b}', '\\parbox{1cm}{p}'],
  ...[
    '\\documentclass{article}',
    '\\endinput',
    '\\centerline{c}',
    '\\minisec{m}',
  ],
  ...['\\begin{itemize}', '\\end{itemize}', '\\begin{enumerate}[(a)]'],
  ...['\\end{enumerate}', '\\begin{description}', '\\end{description}'],
  ...['\\item[t]', '\\begin{quote}', '\\end{quote}', '\\begin{center}'],
  ...[
    '\\end{center}',
    '\\begin{verbatim}',
    '\\end{verbatim}',
    '\\begin{figure}',
  ],
  ...['\\end{figure}', '\\begin{tabular}{lc}', '\\end{tabular}', '\\hline'],
  ...['\\multicolumn{2}{c}{m}', '\\multirow{2}{*}{r}', '\\begin{table}'],
  ...[
    '\\end{table}',
    '\\begin{document}',
    '\\end{document}',
    '\\begin{abstract}',
  ],
  ...['\\end{abstract}', '\\begin{minipage}{1cm}', '\\end{minipage}'],
  ...['\\begin{lstlisting}', '\\end{lstlisting}', '\\toprule', '\\midrule'],
  ...['\\input{a}', '\\include{b}', '\\usepackage{p}', '\\includegraphics{i}'],
  ...['\\includegraphics[width=.5\\textwidth]{j}', '\\subfile{s}', '\\input'],
  ...['\\graphicspath{{f/}}', '\\inputminted{c}{f}', '\\expandafter'],
  ...['\\makeatletter', '\\a@b', '\\makeatother', '#1', '\\and', '\\begin'],
  '\\end',
];

/**
 * LaTeX from commands, environments, macros and text. One `pandoc lua`
 * keeps Pandoc's language across reads: each document sets the CLI's.
 *
 * @param {ReturnType<typeof import('../lib/run.mjs').random>} r
 */
export function latex({ below, pick }) {
  const parts = Array.from({ length: 1 + below(12) }, () => pick(LATEX));
  return `\\setdefaultlanguage[variant=american]{english}\n${parts.join('')}\n`;
}

const SPECS = ['l', 'c', 'r', 'p{2cm}', 'p{0.3\\linewidth}', '|l|', '@{}l'];
const MORE_SPECS = ['>{\\bfseries}c', '*{2}{c}', 'X'];
const CELLS = [
  ...['a', 'b c', '', ' ', '$x$', '\\emph{e}', '\\multicolumn{2}{c}{m}'],
  ...['\\multirow{2}{*}{r}', '\\multicolumn{1}{|r|}{q}', '\\verb|&|'],
  ...['{g & h}', '\\textbf{x}'],
];
const RULES = ['', '\\hline', '\\toprule', '\\midrule', '\\cline{1-2}'];
const ENVIRONMENTS = ['tabular', 'tabular', 'longtable', 'tabularx'];

/**
 * A LaTeX table: random column specs, cells, rules, spanning cells and
 * captions, in a `table` float or not.
 *
 * @param {ReturnType<typeof import('../lib/run.mjs').random>} r
 */
export function latexTables({ below, pick }) {
  const env = pick(ENVIRONMENTS);
  const columns = 1 + below(4);
  const specs = [...SPECS, ...MORE_SPECS];
  const spec = Array.from({ length: columns }, () => pick(specs)).join('');
  const rows = Array.from({ length: below(5) }, () => {
    const cells = Array.from({ length: 1 + below(columns + 1) }, () =>
      pick(CELLS),
    );
    const end = below(7) === 0 ? '' : '\\\\';
    return `${pick([...RULES, '\\cmidrule(lr){1-2}'])}\n${cells.join(' & ')} ${end}`;
  });
  const width = env === 'tabularx' ? '{\\linewidth}' : '';
  const caption = below(5) === 0 ? '\\caption{C}\\label{t}\n' : '';
  const body = `\\begin{${env}}${width}{${spec}}\n${rows.join('\n')}\n${pick(RULES)}\n${caption}\\end{${env}}`;
  return below(10) < 3
    ? `\\begin{table}\n${caption}${body}\n\\end{table}\n\\ref{t}\n`
    : `${body}\n`;
}

const SCALARS = [
  ...['yes', 'No', 'on', 'OFF', 'y', 'n', 'true', 'False', 'null', '~', ''],
  ...['1', '1.0', '-0.5', '+2', '1e3', '2.5e-4', '0x1f', '0o7', '.5', '1_0'],
  ...['12:30', '007', '1e400', '"yes"', "'1'", '!!str 1', '!!int x', 'text'],
  ...[
    '*em*',
    '"*q*"',
    'a: b',
    '"a: b"',
    '[a, b]',
    '{k: v}',
    '>\n  folded\n  text',
  ],
  ...['|\n  lit\n  text', '|-\n  true', '- x', '"\\u00e9"', 'é', 'a # c', '@x'],
  ...['`c`', '"[l](u)"', '&a v', '*a', '12345678901234567890', '0.1'],
  ...['100000000', '1.5e7'],
];
const KEYS = ['a', 'b', 'title', 'k_', '<<', '"q"', '1', 'author', 'a b', 'x'];

/**
 * A YAML metadata block of keys and values in many scalar forms, or a root
 * block scalar, and a paragraph after it.
 *
 * @param {ReturnType<typeof import('../lib/run.mjs').random>} r
 */
export function yaml({ below, pick }) {
  if (below(6) === 0) {
    // A root block scalar, its content at column 0 or indented.
    const header = pick(['>', '|', '>-', '|+', '|2']);
    const content = Array.from({ length: 1 + below(3) }, () =>
      pick(['x', ' x', '  x', '', '}', '- y', 'k: v']),
    );
    return `---\n${header}\n${content.join('\n')}\n...\n\nBody.\n`;
  }
  const lines = Array.from(
    { length: 1 + below(5) },
    () => `${pick(KEYS)}: ${pick(SCALARS)}`,
  );
  return `---\n${lines.join('\n')}\n...\n\nBody.\n`;
}
