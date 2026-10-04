// Spans moved from one text's offsets to another's.

import { Node } from './nodes.js';

/**
 * `value` rebuilt with each node's span mapped, built values never mutated:
 * a start through `toStart`, an end through `toEnd`; an empty span through
 * `toStart` alone, so it stays empty. Frozen values hold no nodes.
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
    const start = toStart(value.start);
    const end = value.end === value.start ? start : toEnd(value.end);
    return new Node(value.t, c, start, end);
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
