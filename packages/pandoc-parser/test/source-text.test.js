// Extracted text and its way back to the offsets it was extracted from.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceText } from '../src/source-text.js';

// `> ab\n> c`: the lines stripped of their markers, joined by a newline
// standing for the line break and the next marker.
const outer = '> ab\n> c';
const quote = SourceText.concat([
  SourceText.slice(outer, 2, 4),
  SourceText.synth('\n', 4, 7),
  SourceText.slice(outer, 7, 8),
]);

test('the text, and a copy mapped offset for offset', () => {
  assert.equal(quote.text, 'ab\nc');
  assert.equal(quote.toOuterStart(0), 2);
  assert.equal(quote.toOuterStart(1), 3);
  assert.equal(quote.toOuterEnd(2), 4);
  assert.equal(quote.toOuterStart(3), 7);
  assert.equal(quote.toOuterEnd(4), 8);
});

test('synthesized text spans what it stands for', () => {
  assert.equal(quote.toOuterStart(2), 4);
  assert.equal(quote.toOuterEnd(3), 7);
});

test('dropped text falls outside what starts or ends beside it', () => {
  // `ab` then `cd`, the space between them dropped.
  const text = SourceText.concat([
    SourceText.slice('ab cd', 0, 2),
    SourceText.slice('ab cd', 3, 5),
  ]);
  assert.equal(text.text, 'abcd');
  assert.equal(text.toOuterEnd(2), 2);
  assert.equal(text.toOuterStart(2), 3);
});

test('copies meeting outside merge into one piece', () => {
  const text = SourceText.concat([
    SourceText.slice('abcd', 0, 2),
    SourceText.slice('abcd', 2, 4),
  ]);
  assert.equal(text.pieces.length, 1);
  assert.equal(text.toOuterEnd(4), 4);
});

test('the ends: before the first piece, past the last', () => {
  assert.equal(quote.toOuterStart(4), 8);
  assert.equal(quote.toOuterEnd(0), 2);
  assert.equal(SourceText.concat([]).toOuterStart(0), 0);
});

test('carriage returns left out, each dropped text in the map', () => {
  const outer = 'ab&#13;c';
  const text = SourceText.concat([
    SourceText.slice(outer, 0, 2),
    SourceText.synth('\r', 2, 7),
    SourceText.slice(outer, 7, 8),
  ]).withoutCarriageReturns();
  assert.equal(text.text, 'abc');
  assert.equal(text.toOuterEnd(2), 2);
  assert.equal(text.toOuterStart(2), 7);
});
