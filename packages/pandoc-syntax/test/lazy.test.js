// Which lines a list item takes lazily.
//
// Pandoc ends a list item's lazy lines at a list start: a bullet or ordered
// marker, or a definition marker. Any other line straight after the item's
// text is the item's. The recognizer must find the blocks Pandoc's parse
// holds, of each kind both name, in order.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pandocKinds, recognizerKinds } from './helpers/kinds.js';
import { TAB_STOPS } from './helpers/pandoc.js';

const CASES = {
  'a definition marker after an item': '- item\n:   def',
  'a term and a marker after an item': '- item\nTerm\n:   def',
  'a definition marker, then a fancy marker': '- item\n:   def\n1) fancy',
  'a tilde marker after an item': '- item\n~   def',
  'an indented definition marker after an item': '- item\n  :   def',
  'a slightly indented marker after an item': '- item\n :   def',
  'a definition marker after an ordered item': '1. item\n:   def',
  'a definition marker after a nested item': '- a\n  - b\n:   def',
  'a definition marker after an item in a quote': '> - item\n> :   def',
  'a colon without a space after an item': '- item\n:def',
  'a bullet after an item': '- a\n- b',
  'a lazy line after an item': '- a\nlazy',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer finds what Pandoc does (tab stop ${tabStop})`, () => {
      const source = `${text}\n`;
      assert.deepEqual(
        recognizerKinds(source, tabStop),
        pandocKinds(source, tabStop),
      );
    });
  }
}
