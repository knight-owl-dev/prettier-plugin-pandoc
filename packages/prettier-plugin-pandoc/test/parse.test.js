// A document Pandoc fails to read: the error prettier frames, at what fails.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import * as prettier from 'prettier';
import plugin from '../src/index.js';

const format = (text) =>
  prettier.format(text, { parser: 'markdown', plugins: [plugin] });

test('a metadata block Pandoc fails to read is framed where it fails', async () => {
  const text = 'Text.\n\n> ---\n> a: *x\n> ---\n';
  await assert.rejects(format(text), (e) => {
    assert.deepEqual(e.loc, {
      start: { line: 4, column: 6 },
      end: { line: 4, column: 6 },
    });
    // prettier colors its frame on a terminal.
    assert.match(
      stripVTControlCharacters(e.message),
      /a: undefined alias \*x\n[\s\S]*> 4 \| > a: \*x/,
    );
    return true;
  });
});
