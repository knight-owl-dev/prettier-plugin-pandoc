// Where a fancy list is, checked against Pandoc rather than asserted.
//
// A fancy list is one whose parse Pandoc records with a style or delimiter
// other than a number and a period: a letter, a roman numeral, `#`, `)` or
// parentheses. Each case holds at most one list that could be fancy, so the
// verdict is whether Pandoc finds one and whether the recognizer does.
//
// A `#.` item continuing a plain list is not here: Pandoc records a plain list,
// yet prettier would not read the item. The oracle corpus checks that one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

function pandocFancy(text, tabStop) {
  const stdout = readPandoc(text, tabStop);
  let fancy = false;
  JSON.parse(stdout, (_, value) => {
    if (value?.t === 'OrderedList') {
      const [, style, delim] = value.c[0];
      const plain = style.t === 'Decimal' && delim.t === 'Period';
      if (!plain && style.t !== 'Example') fancy = true;
    }
    return value;
  });
  return fancy;
}

const recognizerFancy = (text, tabStop) =>
  blocks(text, { tabStop }).some((block) => block.type === 'fancy-list');

const CASES = {
  'lower alpha': 'a. one\nb. two',
  'upper alpha and a parenthesis': 'A) one\nB) two',
  'lower roman': 'i. one\nii. two',
  'upper roman with two spaces': 'I.  one\nII.  two',
  'upper roman with one space': 'I. one\nII. two',
  'hash markers': '#. one\n#. two',
  'letters in parentheses': '(a) one\n(b) two',
  'numbers in parentheses': '(1) one\n(2) two',
  'a number and a parenthesis': '1) one\n2) two',
  'a plain list': '1. one\n2. two',
  'a plain list starting at three': '3. one\n4. two',
  'an initial opening a sentence': 'B. Smith said so.',
  'a capital letter with two spaces': 'A.  one',
  'a letter after a paragraph line': 'prose\na. one',
  'a fancy list nested in a plain one': '1. one\n\n    a. sub',
  'a fancy list in a code block': '```\na. one\n```',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer and Pandoc agree on a fancy list (tab stop ${tabStop})`, () => {
      assert.equal(
        recognizerFancy(`${text}\n`, tabStop),
        pandocFancy(`${text}\n`, tabStop),
      );
    });
  }
}
