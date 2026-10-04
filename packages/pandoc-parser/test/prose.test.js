// Plain prose read as Pandoc reads it: words, spaces, line breaks and smart
// punctuation, from the input Pandoc's CLI hands its reader.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'a word': 'Hello',
  'a sentence': 'Hello, world! This is (plain) prose; a/b c:d e#f.',
  'lines of a paragraph': 'one line\nanother line\n and an indented one',
  'two spaces ending a line': 'a hard  \nbreak, and more   \nbreaks',
  'two paragraphs': 'First paragraph.\n\nSecond paragraph.',
  'blank lines with spaces': 'one\n   \n\t\ntwo',
  'trailing spaces at the end': 'end   ',
  'double quotes': 'She said "hello there" and "bye."',
  'single quotes': "It's 'quoted' and rock 'n' roll, the '90s.",
  'nested quotes': 'He said "she said \'no\' twice" and left.',
  'an unclosed quote': 'An "unclosed quote\n\nends here.',
  'typographic quotes': '‘single’ and “double”',
  dashes: 'a -- b --- c - d ---- e 1-2',
  ellipses: 'Wait... what.... Really..',
  abbreviations: 'Mr. Smith met Dr.\nWho, e.g. this and that, St. Ives.',
  'an abbreviation ending the text': 'Ask Mr.',
  'tabs between words': 'a\tb\t\tc  \td',
  'a tab ending a line': 'a\t\nb',
  CRLF: 'a\r\nb\r\n\r\nc\r\n',
  'a byte order mark': '﻿Hello',
  unicode: 'naïve café 日本語 😀 Ω ω',
  'less-than signs': 'a < b, a<b, <3 and <- arrows',
  'no final newline': 'last line',
  'an empty document': '',
  'blank lines only': '\n\n  \n',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: Pandoc's AST (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        withoutSpans(readMarkdown(text, { tabStop })),
        pandocAst(text, tabStop),
      );
    });
  }
}

// Each node and the source it spans.
const spans = (text, tabStop = 4) => {
  const out = [];
  const visit = (v) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v?.t !== undefined && v.start !== undefined) {
      out.push([v.t, text.slice(v.start, v.end)]);
      if (Array.isArray(v.c)) visit(v.c);
    }
  };
  visit(readMarkdown(text, { tabStop }).blocks);
  return out;
};

test('spans: paragraphs, their words and the space between', () => {
  assert.deepEqual(spans('Hi, you.\n\nNext'), [
    ['Para', 'Hi, you.'],
    ['Str', 'Hi,'],
    ['Space', ' '],
    ['Str', 'you.'],
    ['Para', 'Next'],
    ['Str', 'Next'],
  ]);
});

test('spans: breaks, quotes and smart punctuation', () => {
  assert.deepEqual(spans('a  \nb\nc "q" -- d...'), [
    ['Para', 'a  \nb\nc "q" -- d...'],
    ['Str', 'a'],
    ['LineBreak', '  \n'],
    ['Str', 'b'],
    ['SoftBreak', '\n'],
    ['Str', 'c'],
    ['Space', ' '],
    ['Quoted', '"q"'],
    ['Str', 'q'],
    ['Space', ' '],
    ['Str', '--'],
    ['Space', ' '],
    ['Str', 'd...'],
  ]);
});

test('spans: in the source, through tabs, CRLF and a byte order mark', () => {
  assert.deepEqual(spans('﻿a\tb\r\nc'), [
    ['Para', 'a\tb\r\nc'],
    ['Str', 'a'],
    ['Space', '\t'],
    ['Str', 'b'],
    ['SoftBreak', '\r\n'],
    ['Str', 'c'],
  ]);
});
