import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  breaksParagraph,
  dedent,
  indentOf,
  segmentsOf,
  splitLines,
  strip,
} from '../src/lines.js';

test('lines keep their source offsets, newlines excluded', () => {
  assert.deepEqual(splitLines('a\n\nbc'), [
    { start: 0, end: 1, text: 'a' },
    { start: 2, end: 2, text: '' },
    { start: 3, end: 5, text: 'bc' },
  ]);
});

test('a tab advances indentation to the next stop of four', () => {
  assert.equal(indentOf('\tx'), 4);
  assert.equal(indentOf('  \tx'), 4);
  assert.equal(indentOf('    \tx'), 8);
  assert.equal(indentOf('x'), 0);
});

test('a dedented view moves its start with the text', () => {
  const [line] = splitLines('    code');
  assert.deepEqual(dedent(line, 2), { start: 2, end: 8, text: '  code' });
  assert.deepEqual(dedent(line, 9), { start: 4, end: 8, text: 'code' });
});

test('a tab dedents whole, however many columns are asked', () => {
  const [line] = splitLines('\tcode');
  assert.deepEqual(dedent(line, 2), { start: 1, end: 5, text: 'code' });
});

test('a stripped view moves its start with the text', () => {
  const [line] = splitLines('> quoted');
  assert.deepEqual(strip(line, 2), { start: 2, end: 8, text: 'quoted' });
});

test('segments stop at each line, and at the span on its first and last', () => {
  const text = '> ab\n> cd\n> ef';
  const lines = splitLines(text).map((line) => strip(line, 2));
  const segments = segmentsOf(lines, 0, 2, 3, 13);
  assert.deepEqual(
    segments.map((s) => text.slice(s.start, s.end)),
    ['b', 'cd', 'e'],
  );
});

test('a newline breaks a paragraph when a blank line follows it', () => {
  assert.equal(breaksParagraph('a\n\nb', 1), true);
  assert.equal(breaksParagraph('a\n  \nb', 1), true);
  assert.equal(breaksParagraph('a\nb', 1), false);
  assert.equal(breaksParagraph('a\n', 1), true);
});
