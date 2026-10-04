// Line and column of an offset, as Pandoc's input stream counts them: from
// 1, a column per code point, a tab to the next stop at 1 plus a multiple of 4.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positions } from '../src/index.js';

test('lines from 1, columns from 1', () => {
  const { locate } = positions('ab\ncd\n');
  assert.deepEqual(locate(0), { line: 1, column: 1 });
  assert.deepEqual(locate(1), { line: 1, column: 2 });
  assert.deepEqual(locate(2), { line: 1, column: 3 });
  assert.deepEqual(locate(3), { line: 2, column: 1 });
  assert.deepEqual(locate(6), { line: 3, column: 1 });
});

test('a tab moves to the next multiple of 4, plus one', () => {
  const { locate } = positions('\tx\nab\tx\nabcdefgh\tx');
  assert.deepEqual(locate(1), { line: 1, column: 5 });
  assert.deepEqual(locate(6), { line: 2, column: 5 });
  assert.deepEqual(locate(17), { line: 3, column: 13 });
});

test('a character outside the BMP is one column', () => {
  const { locate } = positions('😀x');
  assert.deepEqual(locate(2), { line: 1, column: 2 });
});

test('a carriage return is a column', () => {
  const { locate } = positions('a\r\nb');
  assert.deepEqual(locate(2), { line: 1, column: 3 });
  assert.deepEqual(locate(3), { line: 2, column: 1 });
});

test('lineStart: the offset each line starts at', () => {
  const { lineStart } = positions('ab\ncd\n');
  assert.equal(lineStart(1), 0);
  assert.equal(lineStart(2), 3);
  assert.equal(lineStart(3), 6);
});

test('a lone surrogate is a column of its own', () => {
  const { locate } = positions('a\udc00b\ud800c');
  assert.deepEqual(locate(3), { line: 1, column: 4 });
  assert.deepEqual(locate(5), { line: 1, column: 6 });
});
