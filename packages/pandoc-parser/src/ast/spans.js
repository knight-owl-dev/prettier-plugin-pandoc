// Spans moved from one text's offsets to another's.

import { Node, Row } from './nodes.js';

/**
 * `value` rebuilt with each node's and row's span mapped, built values never
 * mutated: a start through `toStart`, an end through `toEnd`; an empty span
 * through `toStart` alone, so it stays empty. Frozen values hold no nodes.
 *
 * @template T
 * @param {T} value
 * @param {(offset: number) => number} toStart
 * @param {(offset: number) => number} toEnd
 * @returns {T}
 */
export function mapSpans(value, toStart, toEnd) {
  if (value instanceof Node) {
    const c = mapSpans(value.c, toStart, toEnd);
    const [start, end] = mapSpan(value, toStart, toEnd);
    return new Node(value.t, c, start, end);
  }
  if (value instanceof Row) {
    const cells = mapSpans(value.cells, toStart, toEnd);
    const [start, end] = mapSpan(value, toStart, toEnd);
    return new Row(value.attr, cells, start, end);
  }
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => mapSpans(v, toStart, toEnd));
  }
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, mapSpans(v, toStart, toEnd)]),
  );
}

// A span mapped: an empty one through `toStart` alone, so it stays empty.
function mapSpan({ start, end }, toStart, toEnd) {
  const from = toStart(start);
  return [from, end === start ? from : toEnd(end)];
}
