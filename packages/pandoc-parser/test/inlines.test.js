// Inline lists joined as pandoc-types' `Semigroup Inlines` joins them: only
// where two lists meet.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, Node, nullAttr, withoutSpans } from '../src/index.js';

const s = (c, start, end) => new Node('Str', c, start, end);
const n = (t, start, end) => new Node(t, undefined, start, end);

test('Str meets Str: one Str spanning both', () => {
  assert.deepEqual(B.join([s('a', 0, 1)], [s('b', 1, 2)]), [s('ab', 0, 2)]);
});

// [left, right, what the join keeps], as Builder.hs lists them.
const BREAKS = [
  ['Space', 'Space', ['Space']],
  ['Space', 'SoftBreak', ['SoftBreak']],
  ['SoftBreak', 'Space', ['SoftBreak']],
  ['SoftBreak', 'SoftBreak', ['SoftBreak']],
  ['Space', 'LineBreak', ['LineBreak']],
  ['LineBreak', 'Space', ['LineBreak']],
  ['SoftBreak', 'LineBreak', ['LineBreak']],
  ['LineBreak', 'SoftBreak', ['LineBreak']],
  ['LineBreak', 'LineBreak', ['LineBreak', 'LineBreak']],
];

for (const [left, right, kept] of BREAKS) {
  test(`${left} meets ${right}: ${kept.join(', ')}`, () => {
    const joined = B.join([n(left, 0, 1)], [n(right, 1, 2)]);
    assert.deepEqual(
      joined.map((x) => x.t),
      kept,
    );
    if (kept.length === 1) {
      assert.deepEqual([joined[0].start, joined[0].end], [0, 2]);
    }
  });
}

for (const t of [
  'Emph',
  'Underline',
  'Strong',
  'Subscript',
  'Superscript',
  'Strikeout',
]) {
  test(`${t} meets ${t}: one, its contents appended`, () => {
    const joined = B.join(
      [new Node(t, [s('a', 1, 2)], 0, 3)],
      [new Node(t, [s('b', 4, 5)], 3, 6)],
    );
    assert.deepEqual(joined, [new Node(t, [s('a', 1, 2), s('b', 4, 5)], 0, 6)]);
  });
}

test('SmallCaps, Span, Quoted and Code stay apart', () => {
  const [a, b] = [B.str('a'), B.str('b')];
  for (const [x, y] of [
    [B.smallcaps(a), B.smallcaps(b)],
    [B.spanWith(nullAttr, a), B.spanWith(nullAttr, b)],
    [B.singleQuoted(a), B.singleQuoted(b)],
    [B.code('a'), B.code('b')],
  ]) {
    assert.equal(B.join(x, y).length, 2, x[0].t);
  }
});

test('only where the lists meet: neighbors within one stay as built', () => {
  const joined = B.join([s('a', 0, 1), s('b', 1, 2)], [s('c', 2, 3)]);
  assert.deepEqual(withoutSpans(joined), withoutSpans([s('a'), s('bc')]));
});

test('an empty side: the other list, unchanged', () => {
  const xs = [s('a', 0, 1)];
  assert.equal(B.join(xs, []), xs);
  assert.equal(B.join([], xs), xs);
});

test('join leaves its inputs as they were', () => {
  const [xs, ys] = [[s('a', 0, 1)], [s('b', 1, 2)]];
  B.join(xs, ys);
  assert.deepEqual(xs, [s('a', 0, 1)]);
  assert.deepEqual(ys, [s('b', 1, 2)]);
});

test('concat: each list joined to the next, empty ones between', () => {
  const joined = B.concat([[s('a', 0, 1)], [], [s('b', 1, 2)], [n('Space')]]);
  assert.deepEqual(withoutSpans(joined), withoutSpans([s('ab'), n('Space')]));
});

test('trimInlines: spaces and soft breaks off both ends, line breaks kept', () => {
  const xs = [n('Space'), n('SoftBreak'), s('a'), n('LineBreak'), n('Space')];
  assert.deepEqual(
    withoutSpans(B.trimInlines(xs)),
    withoutSpans([s('a'), n('LineBreak')]),
  );
  assert.deepEqual(B.trimInlines([n('Space')]), []);
});

test('text: words, a Space per run, a SoftBreak where a run breaks a line', () => {
  assert.deepEqual(B.text('a  b\n c\r\td', 10), [
    s('a', 10, 11),
    n('Space', 11, 13),
    s('b', 13, 14),
    n('SoftBreak', 14, 16),
    s('c', 16, 17),
    n('SoftBreak', 17, 19),
    s('d', 19, 20),
  ]);
});

test('text: no melding, as Builder.text is fromList', () => {
  assert.deepEqual(B.text(''), []);
  assert.equal(B.text('a b').length, 1);
});
