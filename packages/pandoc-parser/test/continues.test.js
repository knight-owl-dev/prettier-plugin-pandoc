// Whether a paragraph goes on past a line end, as Pandoc reads a paragraph
// line followed by the next: on where its first block holds a soft break.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { continuesParagraph } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'a word': 'word and more',
  'a backtick fence': '```\ncode\n```',
  'a fence with words after it': '``` words on the line\nmore',
  'a fence with an attribute': '``` haskell\ncode\n```',
  'an indented fence': '  ```\ncode\n```',
  'a tilde fence': '~~~\ncode\n~~~',
  'a list item': '- item',
  'an ordered item': '1. item',
  'a block quote': '> quote',
  'an ATX heading': '# heading',
  'a div fence': '::: note',
  'a closing tag': '</div>',
  'raw TeX': '\\begin{x}\ny\n\\end{x}',
  'a TeX command': '\\newpage',
  'an opening tag': '<div>\nx\n</div>',
  'an inline tag': '<span>x</span>',
  'an HTML comment': '<!-- c -->',
  math: '$x$ more',
  'an indented line': '    indented',
  'a tab-indented fence': '\t```\ncode\n```',
  'a blank line': '\nnext',
};

for (const [name, next] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name} (tab stop ${tabStop})`, () => {
      const [first] = pandocAst(`p\n${next}\n`, tabStop).blocks;
      const expected = JSON.stringify(first).includes('"SoftBreak"');
      assert.equal(continuesParagraph(next, { tabStop }), expected);
    });
  }
}
