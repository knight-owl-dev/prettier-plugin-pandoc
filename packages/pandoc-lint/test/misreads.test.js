// Misreads: a block a paragraph swallows, found where Pandoc reads the line
// as text and the fix, a blank line before it, makes Pandoc read otherwise;
// a closing fence whose length pairs it with another opener than Pandoc's.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pandocAst,
  TAB_STOPS,
} from '../../pandoc-parser/test/helpers/oracle.js';
import { lint } from '../src/index.js';

// Each: the text, the problem at each line it reports, and the text fixed.
const SWALLOWED = {
  'a div fence after text': [
    'Some text\n::: d\nx\n:::\n',
    { 2: 'div fence is read as paragraph text' },
    'Some text\n\n::: d\nx\n:::\n',
  ],
  'a div fence after text in a div': [
    '::: top\nSome text\n::: nested\nx\n:::\n:::\n',
    { 3: 'div fence is read as paragraph text' },
    '::: top\nSome text\n\n::: nested\nx\n:::\n:::\n',
  ],
  'a div fence in a list item': [
    '- item\n  ::: d\n  x\n  :::\n',
    { 2: 'div fence is read as paragraph text' },
    '- item\n\n  ::: d\n  x\n  :::\n',
  ],
  'a div fence in a quote': [
    '> quote\n> ::: d\n> x\n> :::\n',
    { 2: 'div fence is read as paragraph text' },
    '> quote\n>\n> ::: d\n> x\n> :::\n',
  ],
  'a tilde fence': [
    'Text\n~~~ {.js}\ncode\n~~~\n',
    { 2: 'code fence is read as paragraph text' },
    'Text\n\n~~~ {.js}\ncode\n~~~\n',
  ],
  'a heading': [
    'Text\n# Heading\n',
    { 2: 'heading is read as paragraph text' },
    'Text\n\n# Heading\n',
  ],
  'a block quote': [
    'Text\n> quote\n',
    { 2: 'block quote is read as paragraph text' },
    'Text\n\n> quote\n',
  ],
  'a list': [
    'Text\n- a\n- b\n',
    {
      2: 'list is read as paragraph text',
      3: 'list is read as paragraph text',
    },
    'Text\n\n- a\n- b\n',
  ],
  'an ordered list': [
    'Text\n1. a\n',
    { 2: 'list is read as paragraph text' },
    'Text\n\n1. a\n',
  ],
};

// Each: text where nothing is swallowed.
const SILENT = {
  'a fence after a fence': '::: top\n::: nested\nx\n:::\n:::\n',
  'an escaped heading': 'Text\n\\# not a heading\n',
  'an indented line': 'Text\n    indented\n',
  'a heading inside code': 'Text `a\n# b` c\n',
  'a heading inside emphasis': 'Text *a\n# b* c\n',
  'no space after the hash': 'Text\n#hashtag\n',
  'a blank line before': 'Text\n\n# Heading\n',
  'a backtick fence, which ends a paragraph': 'Text\n```\ncode\n```\n',
};

const problems = (text, tabStop) =>
  Object.fromEntries(
    lint([{ path: 'a.md', text }], { tabStop })
      .filter((d) => d.rule === 'block-in-paragraph')
      .map((d) => [d.line, d.callouts.problem]),
  );

for (const [name, [text, expected, fixed]] of Object.entries(SWALLOWED)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name} (tab stop ${tabStop})`, () => {
      assert.deepEqual(problems(text, tabStop), expected);
      assert.notDeepEqual(pandocAst(text, tabStop), pandocAst(fixed, tabStop));
      assert.deepEqual(problems(fixed, tabStop), {});
    });
  }
}

for (const [name, text] of Object.entries(SILENT)) {
  for (const tabStop of TAB_STOPS) {
    test(`silent: ${name} (tab stop ${tabStop})`, () => {
      assert.deepEqual(problems(text, tabStop), {});
    });
  }
}

test('a tab-indented heading in a list item, by tab stop', () => {
  // At 8 the item's text sits 6 columns in: a blank line would make the
  // heading code, so nothing it swallows is a heading.
  const text = '-\titem\n\t# Heading\n';
  assert.deepEqual(problems(text, 4), {
    2: 'heading is read as paragraph text',
  });
  assert.deepEqual(problems(text, 8), {});
});

// Each: text, and the lines of the closers reported.
const FENCES = {
  'a closer shorter than its opener': [
    ':::: top\n::: a\nx\n::::\n:::\n',
    [4, 5],
  ],
  'matched lengths': [':::: top\n::: a\nx\n:::\n::::\n', []],
  'one length throughout': ['::: top\n::: a\nx\n:::\n:::\n', []],
  'one div': [':::: top\nx\n:::\n', []],
  'an outer div unclosed': [':::: top\n::: a\nx\n:::\n', []],
};

for (const [name, [text, lines]] of Object.entries(FENCES)) {
  test(`fence lengths: ${name}`, () => {
    const found = lint([{ path: 'a.md', text }])
      .filter((d) => d.rule === 'div-fence-length')
      .map((d) => d.line);
    assert.deepEqual(found, lines);
  });
}
