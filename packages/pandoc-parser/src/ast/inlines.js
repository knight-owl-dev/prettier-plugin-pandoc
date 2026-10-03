// Inline lists as pandoc-types' builder joins them: where two lists meet,
// adjacent `Str`s concatenate, spaces and breaks collapse, and adjacent
// emphasis of one kind merges. Only at the join: a list's own neighbors are
// left as built.
//
// Ported from pandoc-types 1.23.1.2's `Text.Pandoc.Builder`: its `Many`
// becomes a plain array, never mutated once built.

import { Node } from './nodes.js';

/** @typedef {Node[]} Inlines */

// The breaks that collapse into one another, by which wins: a line break
// over a soft break over a space. Two line breaks stay two.
const BREAK = { Space: 0, SoftBreak: 1, LineBreak: 2 };

// The constructors whose neighbors of the same kind merge into one.
const MERGES = new Set([
  'Emph',
  'Underline',
  'Strong',
  'Subscript',
  'Superscript',
  'Strikeout',
]);

// `x` and `y` as one node where they meet, spanning both, or null.
function meld(x, y) {
  if (x.t === 'Str' && y.t === 'Str') {
    return new Node('Str', x.c + y.c, x.start, y.end);
  }
  const [bx, by] = [BREAK[x.t], BREAK[y.t]];
  if (bx !== undefined && by !== undefined) {
    if (x.t === 'LineBreak' && y.t === 'LineBreak') return null;
    return new Node(bx >= by ? x.t : y.t, undefined, x.start, y.end);
  }
  // Their contents are lists, not `Inlines`: appended, not joined.
  if (x.t === y.t && MERGES.has(x.t)) {
    return new Node(x.t, [...x.c, ...y.c], x.start, y.end);
  }
  return null;
}

// Append `ys` to `out`, melding its first node with `out`'s last.
function appendTo(out, ys) {
  if (ys.length === 0) return;
  const melded = out.length > 0 ? meld(out[out.length - 1], ys[0]) : null;
  if (melded === null) out.push(ys[0]);
  else out[out.length - 1] = melded;
  for (let n = 1; n < ys.length; n++) out.push(ys[n]);
}

/**
 * `xs` then `ys`, melded where they meet.
 *
 * @see Text.Pandoc.Builder.<> (Semigroup Inlines)
 * @param {Inlines} xs
 * @param {Inlines} ys
 * @returns {Inlines}
 */
export function join(xs, ys) {
  if (ys.length === 0) return xs;
  if (xs.length === 0) return ys;
  const out = xs.slice();
  appendTo(out, ys);
  return out;
}

/**
 * The lists in order, melded where each meets the next.
 *
 * @see Text.Pandoc.Builder.mconcat (Monoid Inlines)
 * @param {Inlines[]} lists
 * @returns {Inlines}
 */
export function concat(lists) {
  const out = [];
  for (const ys of lists) appendTo(out, ys);
  return out;
}

const isSpace = (x) => x.t === 'Space' || x.t === 'SoftBreak';

/**
 * `xs` without spaces or soft breaks at either end.
 *
 * @see Text.Pandoc.Builder.trimInlines
 * @param {Inlines} xs
 * @returns {Inlines}
 */
export function trimInlines(xs) {
  let [from, to] = [0, xs.length];
  while (from < to && isSpace(xs[from])) from++;
  while (to > from && isSpace(xs[to - 1])) to--;
  return from === 0 && to === xs.length ? xs : xs.slice(from, to);
}

// A run of spaces, captured, or of anything else: Builder's `is_space`.
const RUNS = /([ \r\n\t]+)|[^ \r\n\t]+/g;

/**
 * `t` as words and the space between them: a run with a line break a
 * `SoftBreak`, any other a `Space`. `t` is the source from `start` on, which
 * gives each node its span.
 *
 * @see Text.Pandoc.Builder.text
 * @param {string} t
 * @param {number} [start]
 * @returns {Inlines}
 */
export function text(t, start = 0) {
  const out = [];
  for (const { 0: run, 1: gap, index } of t.matchAll(RUNS)) {
    const [from, to] = [start + index, start + index + run.length];
    if (gap === undefined) out.push(new Node('Str', run, from, to));
    else if (/[\r\n]/.test(gap))
      out.push(new Node('SoftBreak', undefined, from, to));
    else out.push(new Node('Space', undefined, from, to));
  }
  return out;
}
