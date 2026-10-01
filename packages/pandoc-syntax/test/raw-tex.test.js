// Which text is raw TeX.
//
// Pandoc's parse names each raw TeX block and keeps its text. The recognizer's
// spans must cover the same text, in the same order, and no other block may
// open inside one. Pandoc drops an environment's indentation from what it
// keeps, so both sides are compared with each line's leading space removed.

// cspell:ignore foreignblockquote iffoo newif newtheorem textcolor titleformat
// cspell:ignore newenvironment usepackage textgerman

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

  // Environments and commands run on as one block, whitespace and a line
  // break at most between them.
  'an environment then a command': '\\begin{x}y\\end{x} \\newpage b\n',
  'an environment then an inline command': '\\begin{x}y\\end{x} \\emph{z} b\n',
  'an environment then a command of no known kind, text after':
    '\\begin{x}y\\end{x} \\foo b\n',
  'an environment then a sectioning command':
    '\\begin{x}y\\end{x} \\section{s} b\n',
  'an environment then a definition':
    '\\begin{x}y\\end{x} \\newcommand{\\a}{b} b\n',
  'an environment then commands below':
    '\\begin{x}y\\end{x}\n\\newpage\n\\clearpage b\n',
  'spaces around the line break in a run':
    '\\begin{x}y\\end{x}   \n   \\newpage\n',
  'a percent sign after an environment': '\\begin{x}y\\end{x} % c\n\\newpage\n',
  'a command then an environment': '\\newpage \\begin{x}y\\end{x}\n',
  'two commands': '\\newpage \\clearpage\n',
  'a command then text on its line': '\\newpage b\n',
  'a command then one of no known kind': '\\newpage \\foo\n',
  'a command then one of no known kind, text after': '\\newpage \\foo b\n',
  'one of no known kind then a command': '\\foo \\newpage\n',
  'one of no known kind alone': '\\foo\n',
  'one of no known kind, an argument, then a command': '\\foo{a} \\newpage\n',
  'one of no known kind above a command': '\\foo{a}\n\\newpage\n',
  'commands a blank line apart': '\\newpage\n\n\\clearpage\n',
  'an indented command': '  \\newpage\n',
  'indented commands': '   \\newpage \\clearpage\n',
  'a spaced option then text': '\\newpage [x] b\n',
  'an argument a line down': '\\vspace\n{1em} b\n',
  'a spaced argument': '\\section {s}\n',
  'a starred command then text': '\\section*{s} b\n',
  'an argument across lines': '\\section{a\nb} c\n',
  'an argument across a blank line': '\\newpage{a\n\nb} c\n',
  'a sectioning command then a label': '\\section{s} \\label{l}\n',
  'an item then text': '\\item x tail\n',
  'a caption then text': '\\caption{x} tail\n',
  'a package then text': '\\usepackage{x} tail\n',
  'colored text': '\\textcolor{red}{x}\n',
  'colored text then text': '\\textcolor{red}{x} b\n',
  'a command then colored text': '\\newpage \\textcolor{red}{x}\n',
  'an inline command alone': '\\noindent\n',
  'an inline command alone above text': '\\noindent\ntext\n',
  'an index entry alone': '\\index{x}\n',
  'a citation alone': '\\cite{k}\n',
  'a language command alone': '\\textgerman{x}\n',
  'a block command then an inline one': '\\newpage \\emph{x}\n',
  'one of no known kind then an inline one': '\\foo \\emph{x}\n',
  'a bare inline command then a block command': '\\noindent \\newpage\n',
  'an inline command below a command': '\\newpage\n\\noindent\n',
  'an inline command below an environment':
    '\\begin{x}y\\end{x}\n\\noindent text\n',
  'a definition by newcommand, unbraced': '\\newcommand\\foo{bar}\n',
  'a definition by def, then a command': '\\def\\foo#1{bar #1} \\newpage\n',
  'a definition by let': '\\let\\a\\b\n',
  'a global definition': '\\global\\def\\foo{x}\n',
  'a conditional': '\\newif\\iffoo\n',
  'an option after a group, then text': '\\vspace{1em}[x] b\n',
  'a definition with its arity': '\\newcommand{\\foo}[1]{bar #1} b\n',
  'an environment definition':
    '\\newenvironment{e}[1]{\\begin{center}}{\\end{center}} b\n',
  'a theorem numbered like another': '\\newtheorem{thm}[eq]{Lemma} b\n',
  'a theorem numbered within sections':
    '\\newtheorem{thm}{Theorem}[section] b\n',
  'a title format': '\\titleformat{\\section}[block]{a}{b}{0pt}{c} d\n',
  'a foreign block quote': '\\foreignblockquote{german}[cite]{text} b\n',
  'a comment in a group': '\\section{a % }\nb} c\n',
  'a comment in an environment': '\\begin{x} % \\end{x}\n\\end{x}\n',
  'a comment in a mid-line environment':
    'a \\begin{x} % \\end{x}\n\\end{x} b\n',
  'an environment in a definition term':
    'Term \\begin{x}y\\end{x}\n\n:   def\n',
  'a command above a definition line': '\\newpage\n:   def\n',
  'a run in a block quote': '> \\newpage \\begin{x}y\\end{x}\n> \\clearpage\n',
  'a mid-line environment then a command':
    'a \\begin{x}y\\end{x} \\newpage b\n',

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

  // A block command Pandoc does not also read inline ends the paragraph too.
  'a block command mid-line': 'a \\section{x} b\n',
  'a starred block command with options mid-line': 'a \\section*[o]{x} b\n',
  'a block command of no arguments mid-line': 'a \\hrule b\n',
  'a block command with a spaced argument mid-line': 'a \\section {x} b\n',
  'a block command with an argument across lines': 'a \\section{x\ny} b\n',
  'a block command ending a paragraph line': 'a \\section{x}\nb\n',
  'a block command starting a paragraph line': 'a\n\\section{x} b\n',
  'a block command then a run': 'a \\section{x} \\label{y}\nb\n',
  'a run below a mid-line block command': 'a \\section{x}\n\\label{y}\n\nb\n',
  'an inline command then a block command': 'a \\newpage \\section{x} b\n',
  'an inline command then a block command on a paragraph line':
    'a\n\\newpage \\section{S} text\n',
  'one of no known kind then a block command': '\\foo \\section{x} b\n',
  'a block command in a heading': '# a \\section{x} b\n',
  'a block command in a list item': '- a \\section{x} b\n',
  'a block command in a block quote': '> a \\section{x} b\n',
  'a block command in emphasis': '*a \\section{x} b*\n',
  'a block command in link text': '[a \\section{x} b](u)\n',
  'a block command in brackets': '[a \\section{x}] b\n',
  'a block command in a code span': 'a `\\section{x}` b\n',
  'a block command in math': 'a $\\section{x}$ b\n',
  'an escaped block command': 'a \\\\section{x} b\n',
  "a block command in an unknown command's argument":
    'a \\foo{\\section{x}} b\n',
  'a block command in a definition term': 'Term \\section{x}\n\n:   def\n',
  'a block command then an environment mid-line':
    'a \\section{x} \\begin{y}z\\end{y} b\n',
  'an environment then a block command mid-line':
    'a \\begin{y}z\\end{y} b \\section{x} c\n',
  'a block command without its argument mid-line': 'a \\section b\n',
  'a block command with only options mid-line': 'a \\section[o] b\n',
  'a block command short of its groups mid-line': 'a \\epigraph{x} b\n',
  'a block command with its groups mid-line': 'a \\epigraph{x}{y} b\n',
  'options among the groups of a block command mid-line':
    'a \\epigraph{x}[o]{y} b\n',
  'a block command without its argument in a heading': '# a \\section b\n',
  'a block command short of its groups in a heading': '# a \\epigraph{x} b\n',
  'a block command in an HTML attribute':
    'a <span title="\\section{x}">c</span> b\n',
  'a block command in an unquoted HTML attribute':
    'a <span title=\\section{x}>c</span> b\n',
  'a block command in an HTML tag across lines':
    'a <span\ntitle="\\section{x}">c</span> b\n',
  'a block command in a closing HTML tag': 'a </span x="\\section{x}"> b\n',
  'a block command in what is no HTML tag': 'a <b \\section{x}> c\n',
  'an environment in an HTML attribute':
    'a <span title="\\begin{x}y\\end{x}">c</span> b\n',
};

// cspell:disable
// Block commands Pandoc also reads inline, which stay in the paragraph.
for (const name of [
  'clearpage',
  'colorbox',
  'hspace',
  'hypertarget',
  'iftoggle',
  'input',
  'newpage',
  'newtoggle',
  'pagebreak',
  'textcolor',
  'togglefalse',
  'toggletrue',
  'vspace',
]) {
  CASES[`\\${name} mid-line`] = `a \\${name}{x} b\n`;
  CASES[`\\${name} on a paragraph line`] = `a\n\\${name}{x} b\n`;
}
// cspell:enable

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
