// Which lines end the paragraph before them.
//
// Pandoc's parse of a paragraph line and the line after it says whether the
// paragraph ran on; `interruptsParagraph` must say the same. Every HTML
// element is asked, opening and closing, since the block tags are a list
// Pandoc keeps and nothing else here can check.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interruptsParagraph } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

// cspell:disable
const ELEMENTS = `a abbr address area article aside audio b base bdi bdo
  blockquote body br button canvas caption center cite code col colgroup data
  datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption
  figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup
  hr html i iframe img input ins kbd label legend li link main map mark math
  menu meta meter nav noframes noscript object ol optgroup option output p
  param picture pre progress q rp rt ruby s samp script search section select
  slot small source span strong style sub summary sup svg table tbody td
  template textarea tfoot th thead time title tr track u ul var video wbr`
  .trim()
  .split(/\s+/);
// cspell:enable

function pandocInterrupts(line, { before, after }, tabStop) {
  const text = `${before}\n${line}\n${after}`;
  const [first] = JSON.parse(readPandoc(text, tabStop)).blocks;
  return !(first.t === 'Para' && first.c.length > 1);
}

// A case is a line, or a line with the paragraph line above it and the text
// after it.
const CASES = {
  'a setext underline': '--',
  'a setext underline of equals signs': '==',
  'a dash followed by text': '-- and more',
  'an unclosed code fence': '```',
  'a closed code fence': ['```', { after: 'code\n```\n' }],
  'an unclosed tilde fence': '~~~',
  'a closed tilde fence': ['~~~', { after: 'code\n~~~\n' }],
  'an unclosed environment': '\\begin{center}',
  'a closed environment': ['\\begin{center}', { after: 'x\n\\end{center}\n' }],
  'a definition marker straight after': ': definition',
  'a lone colon': ':',
  'a tilde definition marker': '~ definition',
  'a pipe separator under a pipe header': ['|---|---|', { before: 'a | b' }],
  'a pipe separator under prose': '|---|---|',
  'a heading marker': '# Heading',
  'a list marker': '- item',
  'a div fence': '::: note',
  'a pipe': '| verse',
  'an uppercase tag': '<DIV>',
  'a tag with attributes': '<div class="x">',
  'a self-closing tag': '<hr/>',
  'an indented tag': '   <div>',
  'a tag indented as code': '    <div>',
};
for (const element of ELEMENTS) {
  CASES[`<${element}>`] = `<${element}>`;
  CASES[`</${element}>`] = `</${element}>`;
}

for (const [name, value] of Object.entries(CASES)) {
  const [line, given = {}] = [value].flat();
  const around = { before: 'text', after: '', ...given };
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree whether it ends a paragraph (tab stop ${tabStop})`, () => {
      assert.equal(
        interruptsParagraph(line, { tabStop, ...around }),
        pandocInterrupts(line, around, tabStop),
      );
    });
  }
}
