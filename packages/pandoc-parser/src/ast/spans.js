// Spans moved from one text's offsets to another's.

import { Node, Row } from './nodes.js';

/**
 * Give a list read again from extracted text that text, as it was read:
 * a property JSON leaves out.
 *
 * @param {unknown[]} list
 * @param {import('../source-text.js').SourceText} contents
 */
export function withContents(list, contents) {
  Object.defineProperty(list, 'contents', { value: contents });
  return list;
}

/**
 * `to`, a list rebuilt from `from`, given the text `from` was read from.
 *
 * @template {unknown[]} T
 * @param {unknown[]} from
 * @param {T} to
 * @returns {T}
 */
export const keepContents = (from, to) =>
  from.contents === undefined ? to : withContents(to, from.contents);

/**
 * `value` rebuilt with each node's and row's span mapped, built values never
 * mutated: a start through `toStart`, an end through `toEnd`; an empty span
 * through `toStart` alone, so it stays empty. Frozen values hold no nodes.
 * A list's `contents` maps on through `outer`, where there is one.
 *
 * @template T
 * @param {T} value
 * @param {(offset: number) => number} toStart
 * @param {(offset: number) => number} toEnd
 * @param {import('../source-text.js').SourceText} [outer]
 * @returns {T}
 */
export function mapSpans(value, toStart, toEnd, outer) {
  if (value instanceof Node) {
    const c = mapSpans(value.c, toStart, toEnd, outer);
    const [start, end] = mapSpan(value, toStart, toEnd);
    return new Node(value.t, c, start, end);
  }
  if (value instanceof Row) {
    const cells = mapSpans(value.cells, toStart, toEnd, outer);
    const [start, end] = mapSpan(value, toStart, toEnd);
    return new Row(value.attr, cells, start, end);
  }
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    const list = value.map((v) => mapSpans(v, toStart, toEnd, outer));
    const { contents } = value;
    if (outer === undefined || contents === undefined) return list;
    return withContents(list, contents.through(outer));
  }
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      mapSpans(v, toStart, toEnd, outer),
    ]),
  );
}

// A span mapped: an empty one through `toStart` alone, so it stays empty.
function mapSpan({ start, end }, toStart, toEnd) {
  const from = toStart(start);
  return [from, end === start ? from : toEnd(end)];
}
