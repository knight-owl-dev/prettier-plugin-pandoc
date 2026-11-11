// Files read as Pandoc's CLI reads several: joined into one document, each
// offset found again in its file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PandocParseError,
  readMarkdown,
  toSources,
  withoutSpans,
} from '../src/index.js';
import { pandocFiles, pandocFilesAst } from './helpers/oracle.js';

const CASES = {
  'a paragraph ends with its file': ['one', 'two\n'],
  'a definition serves the next file': ['[a]: /a', 'See [a].\n'],
  'a fence runs on': ['```\nA\n', 'B\n```\n'],
  'a fence runs on from no newline': ['```\nA', 'B\n```\n'],
  'blank lines kept': ['```\nA\n\n', 'B\n```\n'],
  'an empty file': ['```\nA\n', '', 'B\n```\n'],
  'carriage returns': ['```\r\nA\r\n', 'B\r\n```\r\n'],
  'a byte order mark': ['﻿# One\n', '﻿# Two\n'],
  'a div runs on': ['::: d\nopen\n', 'more\n'],
  // A tokenizer drift stays in the file it happens in.
  'raw TeX runs on past control spaces': [
    '\\begin{foo}\na\\ \nb\\ \nc\\ \nd\n',
    'e\n\\end{foo}\n\nafter\n',
  ],
  'raw TeX runs on past ^^ line ends': [
    '\\begin{foo}\na^^\nb^^\nc^^\nd\n',
    'e\n\\end{foo}\n\nafter\n',
  ],
  'raw TeX runs on into a short file': [
    `\\begin{foo}\n${'x\\ \ny\n'.repeat(6)}`,
    '\\end{foo}\nafter\n',
  ],
  '\\endinput skips the rest of its file alone': [
    'x\n\n\\endinput\ny\n',
    'z\n',
  ],
  'raw TeX ends in its file, more after': [
    '\\begin{foo}\na\\ \nb\n\\end{foo}\n',
    'c\n\\begin{bar}\nd\n\\end{bar}\n',
  ],
};

for (const [name, texts] of Object.entries(CASES)) {
  test(name, () => {
    const files = texts.map((text, k) => ({ path: `f${k}.md`, text }));
    const { text, sources } = toSources(files);
    const read = readMarkdown(text, { sources });
    const ours = JSON.parse(JSON.stringify(withoutSpans(read)));
    assert.deepEqual(ours, pandocFilesAst(files));
  });
}

// Pandoc fails on raw TeX that runs on into a file whose name sorts first.
test('raw TeX into a file whose name sorts first: Pandoc fails', () => {
  const files = [
    { path: 'ch9.md', text: '\\begin{foo}\na\nb\n' },
    { path: 'ch10.md', text: 'e\n\\end{foo}\n\nafter\n' },
  ];
  assert.throws(() => pandocFiles(files), /combinator 'many'/);
  const { text, sources } = toSources(files);
  assert.throws(
    () => readMarkdown(text, { sources }),
    (e) =>
      e instanceof PandocParseError &&
      e.start === 0 &&
      e.detail.file === 'ch9.md' &&
      e.detail.into === 'ch10.md',
  );
  // In the order their names sort, the same TeX reads.
  const sorted = [
    { path: 'ch09.md', text: files[0].text },
    { path: 'ch10.md', text: files[1].text },
  ];
  const joined = toSources(sorted);
  const ours = withoutSpans(readMarkdown(joined.text, joined));
  assert.deepEqual(JSON.parse(JSON.stringify(ours)), pandocFilesAst(sorted));
});

test('raw TeX into the same file read again: Pandoc fails', () => {
  const text = '\\end{foo}\n\n\\begin{foo}\nx\n';
  const files = [
    { path: 'a.md', text },
    { path: 'a.md', text },
  ];
  assert.throws(() => pandocFiles(files), /combinator 'many'/);
  const joined = toSources(files);
  assert.throws(
    () => readMarkdown(joined.text, joined),
    (e) => e instanceof PandocParseError && e.detail.into === 'a.md',
  );
});

test('an offset found in its file', () => {
  const files = [
    { path: 'a.md', text: '﻿ab' },
    { path: 'b.md', text: 'cd\n' },
  ];
  const { text, locate } = toSources(files);
  assert.equal(text, '﻿ab\n\ncd\n\n'.slice(1));
  assert.deepEqual(locate(0), { path: 'a.md', offset: 1 });
  assert.deepEqual(locate(2), { path: 'a.md', offset: 3 });
  assert.deepEqual(locate(3), { path: 'a.md', offset: 3 });
  assert.deepEqual(locate(4), { path: 'b.md', offset: 0 });
  assert.deepEqual(locate(7), { path: 'b.md', offset: 3 });
});
