// Pandoc's inline commands, as `tex-names.js` lists them.
//
// Each is a command Pandoc reads alone on a line in a paragraph, where one it
// does not know is a raw block. The recognizer must read it so too.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';
import { INLINE_COMMANDS } from '../src/tex-names.js';
import { readPandoc } from './helpers/pandoc.js';

const rawBlocks = (text) =>
  JSON.parse(readPandoc(text, 4)).blocks.filter((b) => b.t === 'RawBlock');

for (const name of INLINE_COMMANDS) {
  test(`\\${name} alone on a line is no raw block`, () => {
    const text = `\\${name}\n`;
    assert.deepEqual(rawBlocks(text), []);
    assert.deepEqual(
      blocks(text).filter((block) => block.type === 'raw-tex'),
      [],
    );
  });
}

test('one of no known kind alone on a line is a raw block', () => {
  assert.equal(rawBlocks('\\foo\n').length, 1);
});
