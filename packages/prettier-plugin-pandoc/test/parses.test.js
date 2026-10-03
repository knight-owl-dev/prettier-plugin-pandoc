// How often formatting parses a document.
//
// Each stretch printed as written needs the document parsed again, so a pass
// settles every one it safely can. Many misreads that shift nothing after them
// must cost a fixed number of parses, not one each.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as prettier from 'prettier';
import * as markdown from 'prettier/plugins/markdown';
import plugin from '../src/index.js';

const base = markdown.parsers.markdown;
const { parse } = base;
let parses = 0;
const counted = (...args) => {
  parses++;
  return parse.apply(base, args);
};
base.parse = counted;
afterEach(() => {
  parses = 0;
});

const many = (n, part) =>
  Array.from({ length: n }, (_, i) => part(i)).join('\n');

for (const [name, text] of Object.entries({
  'environments in paragraph text': many(
    200,
    (i) => `Paragraph ${i} holds \\begin{x}an environment\\end{x} mid-line.\n`,
  ),
  'text after raw TeX on its line': many(
    200,
    (i) => `\\newpage \\section{S ${i}} text after the command\n`,
  ),
  'blocks opening after raw TeX': many(
    200,
    (i) => `\\begin{x}y\\end{x} ::: note\nbody ${i}\n:::\n`,
  ),
})) {
  test(`${name}: formatting parses the document twice`, async () => {
    await prettier.format(text, { parser: 'markdown', plugins: [plugin] });
    assert.equal(parses, 2);
  });
}

// A parse that ignores the mask reads the same misread on every pass.
test('a misread that never settles fails instead of hanging', async () => {
  const text = 'Para \\begin{x}a\\end{x} b\n';
  base.parse = (_, options) => parse.call(base, text, options);
  try {
    await assert.rejects(
      prettier.format(text, { parser: 'markdown', plugins: [plugin] }),
      /never settles/,
    );
  } finally {
    base.parse = counted;
  }
});
