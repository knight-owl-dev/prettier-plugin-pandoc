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
  'a definition list inside a div': '::: note\nTerm\n:   Def\n:::',
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
