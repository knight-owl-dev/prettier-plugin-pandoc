// Display width, measured as Pandoc measures it: every code point, after a
// character and alone, and the emoji sequences that join or modify one.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitTextByIndices } from '../src/shared.js';
import { realLength } from '../src/text-width.js';
import { pandocRealLength } from './helpers/oracle.js';

const u = (...cps) => String.fromCodePoint(...cps);

// Each code point but the surrogates and the line breaks the oracle reads
// lines by.
function* codePoints() {
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if ((cp < 0xd800 || cp > 0xdfff) && cp !== 0x0a && cp !== 0x0d) yield cp;
  }
}

// Emoji and the blocks around them, each with the modifiers that may follow.
function* sequences() {
  for (const [from, to] of [
    [0x2000, 0x33ff],
    [0x1f000, 0x1faff],
  ]) {
    for (let cp = from; cp <= to; cp++) {
      yield u(cp, 0xfe0f);
      yield u(cp, 0x1f3fb);
      yield u(cp, 0x200d, 0x1f600);
      yield u(cp, 0xfe0f, 0x200d, 0x2764, 0xfe0f);
      yield u(0x61, cp, 0x301);
    }
  }
}

test("realLength: Pandoc's, for every code point and emoji sequence", () => {
  const texts = [];
  for (const cp of codePoints()) texts.push(u(cp), `x${u(cp)}`);
  texts.push(...sequences());
  const want = pandocRealLength(texts);
  const wrong = texts.filter((t, i) => realLength(t) !== want[i]);
  assert.deepEqual(wrong.slice(0, 10), []);
});

test('splitTextByIndices: pieces at display widths', () => {
  const text = 'ab日本cd';
  const pieces = splitTextByIndices([1, 4, 5], text);
  assert.deepEqual(
    pieces.map(([start, end]) => text.slice(start, end)),
    ['a', 'b日', '本', 'cd'],
  );
  assert.deepEqual(
    splitTextByIndices([0, 9], 'ab').map(([s, e]) => 'ab'.slice(s, e)),
    ['', 'ab', ''],
  );
});
