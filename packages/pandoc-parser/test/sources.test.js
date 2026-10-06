// Files read as Pandoc's CLI reads several: joined into one document, each
// offset found again in its file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, toSources, withoutSpans } from '../src/index.js';
import { pandocFilesAst } from './helpers/oracle.js';

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
};

for (const [name, texts] of Object.entries(CASES)) {
  test(name, () => {
    const files = texts.map((text, k) => ({ path: `f${k}.md`, text }));
    const { text } = toSources(files);
    const ours = JSON.parse(JSON.stringify(withoutSpans(readMarkdown(text))));
    assert.deepEqual(ours, pandocFilesAst(files));
  });
}

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
