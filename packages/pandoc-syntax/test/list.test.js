// Which lines form definition and example lists.
//
// Pandoc's parse gives each list its entries. The recognizer's spans must hold
// the same lists, of the same kind, in the same order.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

function pandocLists(text, tabStop) {
  const stdout = readPandoc(text, tabStop);
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    if (node.t === 'DefinitionList') found.push('definition-list');
    if (node.t === 'OrderedList' && node.c[0][1].t === 'Example') {
      found.push('example-list');
    }
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(stdout).blocks);
  return found;
}

const recognizerLists = (text, tabStop) =>
  blocks(text, { tabStop })
    .filter((b) => b.type === 'definition-list' || b.type === 'example-list')
    .map((b) => b.type);

const GRID = '+---+---+\n| a | b |\n+===+===+\n| 1 | 2 |\n+---+---+';
const PIPE = '| a | b |\n|---|---|\n| 1 | 2 |';
const SIMPLE = '  a   b\n --- ---\n  1   2';

const CASES = {
  'a tight definition': 'Term\n:   Def',
  'a loose definition': 'Term\n\n:   Def',
  'a tilde marker': 'Term\n~   Def',
  'two definitions of one term': 'Term\n:   One\n:   Two',
  'a lazy continuation': 'Term\n:   Def line\nlazy line',
  'an indented second paragraph': 'Term\n:   Def\n\n    Second para',
  'text after a blank line': 'Term\n:   Def\n\ntext',
  'two terms': 'T1\n:   D1\n\nT2\n:   D2',
  'a marker indented two spaces': 'Term\n  : Def',
  'a marker indented three spaces': 'Term\n   : Def',
  'a marker indented five spaces': 'Term\n     : Def',
  'a two-space line after a blank': 'Term\n:   Def\n\n  more',
  'a marker with no space after': 'Term\n:Def',
  'an empty definition': 'Term\n:',
  'an empty definition then another': 'Term\n:\n:   Two',
  'a term after a paragraph line': 'prose\nTerm\n:   Def',
  'a two-line term': 'Term one\nterm two\n:   Def',
  'a heading over a marker': '# Heading\n:   Def',
  'example items': '(@)  one\n(@)  two',
  'a labeled example': '(@good)  one',
  'text straight after an example': '(@)  one\ntext',
  'text after a blank line and an example': '(@)  one\n\ntext',
  'an example after a paragraph line': 'prose\n(@)  one',
  'an example continuation': '(@)  one long\n     continued',
  'examples split by a paragraph': '(@)  one\n\nExplain.\n\n(@)  two',
  'examples split by a blank line': '(@)  one\n\n(@)  two',
  'a counted example': '(1@)  one\n(@)  two',
  'a counted, labeled example': '(3@good)  one',
  'a period after the @': '@.  one\n@.  two',
  'a parenthesis after the @': '@)  one',
  'a parenthesis after a label': '@good)  one',
  'a period after a count': '1@.  one',
  'an example with nothing after it': '(@)\n(@)  two',
  'an example indented three spaces': '   (@)  one',
  'an example indented four spaces': '    (@)  one',
  'a letter before the @': '(a@)  one',
  'a space inside the marker': '(1 @)  one',
  'a definition list inside a div': '::: note\nTerm\n:   Def\n:::',
  // A table's caption: Pandoc opens no list where a table follows the
  // term's blank line, caption first.
  'a caption over a grid table': `Term\n\n: cap\n\n${GRID}`,
  'a caption over a pipe table': `Term\n\n: cap\n\n${PIPE}`,
  'a caption over a simple table': `Term\n\n: cap\n\n${SIMPLE}`,
  'a two-line caption': `Term\n\n: cap\nmore\n\n${PIPE}`,
  'a caption two blank lines over a table': `Term\n\n: cap\n\n\n${PIPE}`,
  'a caption with a tab after its colon': `Term\n\n:\tcap\n\n${PIPE}`,
  'a caption indented three spaces': `Term\n\n   : cap\n\n${PIPE}`,
  'a caption over an indented table': `Term\n\n: cap\n\n    ${PIPE.replaceAll('\n', '\n    ')}`,
  'a caption in a block quote': `> Term\n>\n> : cap\n>\n> ${PIPE.replaceAll('\n', '\n> ')}`,
  'a caption straight over a table': `Term\n\n: cap\n${PIPE}`,
  'a caption straight after the term': `Term\n: cap\n\n${PIPE}`,
  'a tilde over a table': `Term\n\n~ cap\n\n${PIPE}`,
  'a table header at the marker': 'Term\n\n: a   b\n----- ---\n1     2',
  'a caption over text': 'Term\n\n: cap\n\nnot a table',
  'a code span past the blank line': `Term\n\n: \`x\n\ny\` z\n\n${PIPE}`,
  'a caption ending in attributes': `Term\n\n: cap {#t}\nmore\n\n${PIPE}`,
  'a caption ending in empty attributes': `Term\n\n: cap {}\nmore\n\n${PIPE}`,
  'a caption ending in classes and keys': `Term\n\n: cap {.c k="a b"}\nmore\n\n${PIPE}`,
  'a caption ending in braces': `Term\n\n: cap {x}\nmore\n\n${PIPE}`,
  'a caption with attributes mid-line': `Term\n\n: cap {#t} x\nmore\n\n${PIPE}`,
  'a caption over an unclosed grid table': 'Term\n\n: cap\n\n+---+\n| a |',
  'a caption over a table without rows': 'Term\n\n: cap\n\n  a   b\n --- ---',
  'a fence after a caption': `Term\n\n: cap\n\`\`\`\ncode\n\`\`\`\n\n${PIPE}`,
  'a div close after a caption': `::: d\nTerm\n\n: cap\n:::\n\n${PIPE}`,
  'a list item after a caption in an item': `- Term\n\n  : cap\n  - x\n\n  ${PIPE.replaceAll('\n', '\n  ')}`,
  'an HTML block after a caption': `Term\n\n: cap\n<div>\n\n${PIPE}`,
  "a caption ending in a link's attributes": `Term\n\n: cap [x](u){#t}\n${PIPE}`,
  'a caption ending in a span': `Term\n\n: cap [x]{#t}\n${PIPE}`,
  "a caption ending in a code span's attributes": `Term\n\n: cap \`x\`{#t}\n${PIPE}`,
  'a caption ending in escaped braces': `Term\n\n: cap \\{#t}\n${PIPE}`,
  'a caption holding a block tag': `Term\n\n: cap <div>\n\n${PIPE}`,
  'a caption holding a closing block tag': `Term\n\n: cap </div>\n\n${PIPE}`,
  'a comment held past the table': `Term\n\n: cap <!-- x\n\n${PIPE}\n\n-->`,
  'an environment held past the table': `Term\n\n: cap \\begin{x}\n\n${PIPE}\n\n\\end{x}`,
  'a second definition over a table': `Term\n\n: def\n\n: cap\n\n${PIPE}`,
  'a second term over a table': `T1\n\n: d1\n\nT2\n\n: cap\n\n${PIPE}`,
  'an example list cutting a code span short in an item':
    '- see `a\n  (@) c\n  d` e',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on the lists (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerLists(`${text}\n`, tabStop),
        pandocLists(`${text}\n`, tabStop),
      );
    });
  }
}
