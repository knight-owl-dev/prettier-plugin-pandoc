// Which lines are headings and thematic breaks.
//
// Pandoc wants a blank line before an ATX heading or a thematic break, and
// underlines only a one-line paragraph. The recognizer must report the
// headings and breaks Pandoc's parse holds, in order, each from its first line.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { readPandoc, TAB_STOPS } from './helpers/pandoc.js';

const KIND = { Header: 'heading', HorizontalRule: 'thematic-break' };

function pandocKinds(text, tabStop) {
  const kinds = [];
  JSON.parse(readPandoc(text, tabStop), (_, value) => {
    if (KIND[value?.t] !== undefined) kinds.push(KIND[value.t]);
    return value;
  });
  return kinds;
}

const recognizerKinds = (text, tabStop) =>
  blocks(text, { tabStop })
    .map((block) => block.type)
    .filter((type) => type === 'heading' || type === 'thematic-break');

const CASES = {
  'an ATX heading': '# H\n',
  'an ATX heading after a blank line': 'text\n\n# H\n',
  'an ATX heading after a paragraph line': 'text\n# H\n',
  'a bare hash after a paragraph line': 'text\n#\n',
  'a closed ATX heading after a paragraph line': 'text\n## H ##\n',
  'an ATX heading after a quoted line': '> text\n> # H\n',
  'an ATX heading in a block quote': '> # H\n',
  'an ATX heading in a list item': '- # H\n',
  'an ATX heading after a list item line': '- text\n  # H\n',
  'an indented hash after a paragraph line': 'text\n    # H\n',
  'a hash without a space': '#H\n',
  'a setext heading': 'text\n===\n',
  'a dashed setext heading': 'text\n---\n',
  'an underline below two lines': 'a\nb\n===\n',
  'a dashed underline below two lines': 'a\nb\n---\n',
  'a thematic break': '***\n',
  'a thematic break after a blank line': 'text\n\n***\n',
  'a thematic break after a paragraph line': 'text\n***\n',
  'underscores after a paragraph line': 'text\n___\n',
  'spaced dashes after a paragraph line': 'text\n- - -\n',
  'asterisks after a list item line': '- a\n***\n',
  'spaced asterisks after a list item line': '- a\n* * *\n',
  'spaced dashes after a list item line': '- a\n- - -\n',
  'underscores after an ordered item line': '1. a\n___\n',
  'an underline below a list item line': '- a\n---\n',
  'an underline below two list item lines': '- a\n  b\n---\n',
  'a thematic break after a list item and a blank line': '- a\n\n***\n',
  'a heading after an environment on its line': '\\begin{x}y\\end{x} # H\n',
  'a setext heading after an environment on its line':
    '\\begin{x}y\\end{x} text\n===\n',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer finds Pandoc's headings and breaks (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerKinds(text, tabStop),
        pandocKinds(text, tabStop),
      );
    });
  }
}

test('a heading reports its lines', () => {
  const text = 'para\n\na\n===\n\n# H\n';
  assert.deepEqual(
    blocks(text)
      .filter((block) => block.type === 'heading')
      .map((block) => text.slice(block.start, block.end)),
    ['a\n===', '# H'],
  );
});
