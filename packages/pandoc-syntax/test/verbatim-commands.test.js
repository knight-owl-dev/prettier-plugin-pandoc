// Commands whose body Pandoc reads verbatim between delimiters.
//
// `\verb`, `\Verb`, `\lstinline` and `\mintinline` keep their delimited body
// raw, so a block command in it opens no block. The recognizer must report
// the raw inline Pandoc keeps, and no block inside it.

// cspell:disable

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlines } from '../src/index.js';
import { pandocKinds, recognizerKinds } from './helpers/kinds.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

const CASES = {
  'a delimited verb': 'a \\verb|\\section{x}| b',
  'a starred verb': 'a \\verb*|\\section{x}| b',
  'a verb after a space': 'a \\verb |\\section{x}| b',
  'an environment in a verb': 'a \\verb+\\begin{x}y\\end{x}+ b',
  'a Verb': 'a \\Verb|\\section{x}| b',
  'an lstinline': 'a \\lstinline|\\section{x}| b',
  'an lstinline with options': 'a \\lstinline[l]|\\section{x}| b',
  'an lstinline in braces': 'a \\lstinline{\\section{x}} b',
  'a mintinline': 'a \\mintinline{c}|\\section{x}| b',
  'a verb a line break cuts': 'a \\verb|x\n\\section{y}\n|z b',
  'an lstinline across a line break': 'a \\lstinline{x\n\\section{y}} b',
  'a verb opened by a brace': 'a \\verb{a{\\section{x}} b',
  'a verb opened by a letter': 'a \\verb a\\section{x}a b',
  'a verb opened by a digit': 'a \\verb 1\\section{x}1 b',
  'a verb opened by a percent sign': 'a \\verb%\\section{x}% b',
  'a space after a mintinline language':
    'aaa bbb \\mintinline{c} |\\section{x}| ccc ddd',
  'a space before lstinline options': 'a \\lstinline [l]|\\section{x}| b',
  'a space before a mintinline language': 'a \\mintinline {c}|\\section{x}| b',
  'a line break after a verb star': 'a \\verb*\n|\\section{x}| b',
  'a line break after lstinline options': 'a \\lstinline[l]\n|\\section{x}| b',
  'a starred lstinline': 'a \\lstinline*|\\section{x}| b',
  'a starred mintinline': 'a \\mintinline*{c}|\\section{x}| b',
  'a verb with an overlay': 'a \\verb<1>|\\section{x}| b',
  'a mintinline with two options': 'a \\mintinline[a][b]{c}|\\section{x}| b',
  'a gap after an overlay': 'aaa \\lstinline<1> |x\n\\section{y}\n| b',
  'a word as an overlay': 'aaa \\lstinline<a>|x\n\\section{y}\n| b',
  'two lstinline options': 'aaa \\lstinline[a][b]|x\n\\section{y}\n| b',
  'a less-than sign as the delimiter': 'a \\verb<\\section{x}< b',
  'a comment after a verb star': 'a \\verb*%c\n|\\section{x}| b',
  'an emoji as the delimiter': 'a \\verb😀\\section{x}😁 b \\section{y} 😀 c',
  'an empty overlay': 'a \\verb<>|\\section{x}| b',
  'an overlay across a line break': 'a \\lstinline<1\n2>|\\section{x}| b',
  'an lstinline option no keyval': 'a \\lstinline[x.y]|\\section{z}| b',
  'a mintinline language a line down': 'a \\mintinline\n{c}|\\section{y}| b',
  'a hash before a digit': 'a \\verb#1\\section{x}#1 b',
  'a mode overlay': 'a \\verb<beamer>|\\section{x}| b',
  'an overlay between mintinline options':
    'a \\mintinline[a]<2>{c}|\\section{x}| b',
  'a braced keyval value with a comma':
    'Call \\lstinline[morekeywords={a,b}]|\\section{x}| here.',
  'an overlay after a space in mintinline':
    'a \\mintinline<1> <2>{py}|\\section{x}| b',
  'a nested bracket in mintinline options':
    'a \\mintinline[a[b]c]{py}|\\section{x}| b',
  'an empty lstinline option': 'a \\lstinline[ ]|\\section{x}| b',
  'a no-break space as the delimiter': 'a \\verb\u00a0\\section{x}\u00a0 b',
  'a verb ending its line': 'Text \\verb\n|ab| and \\section{x} more',
  'a fence after a verb holding a section':
    'a `b\nc` \\verb|\\section{x}| d\n```\ne\n```',
};

function pandocRaw(text, tabStop) {
  const found = [];
  JSON.parse(readPandoc(text, tabStop), (_, value) => {
    if (value?.t === 'RawInline' && value.c[0] === 'tex')
      found.push(value.c[1]);
    return value;
  });
  return found;
}

// A body past a blank line, which Pandoc reads raw and the recognizer, like
// every argument, ends at the paragraph's end (#50): only its blocks agree.
const PAST_BLANK = {
  'an lstinline cut by a table':
    'see \\lstinline|x for\n\n| a | b |\n|---|---|\n| 1 | 2 |',
  'an lstinline in a quote, past its blank line':
    '> a \\lstinline{x\n>\n> b} c',
};

for (const [name, text] of Object.entries(PAST_BLANK)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the blocks Pandoc reads (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerKinds(`${text}\n`, tabStop),
        pandocKinds(`${text}\n`, tabStop),
      );
    });
  }
}

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the blocks Pandoc reads (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerKinds(`${text}\n`, tabStop),
        pandocKinds(`${text}\n`, tabStop),
      );
    });
  }
  test(`${name}: each raw inline lies in a span`, () => {
    const source = `${text}\n`;
    const spans = inlines(source).map((s) => source.slice(s.start, s.end));
    for (const raw of pandocRaw(source, 4)) {
      assert.ok(
        spans.some((span) => span.includes(raw.trim())),
        raw,
      );
    }
  });
}
