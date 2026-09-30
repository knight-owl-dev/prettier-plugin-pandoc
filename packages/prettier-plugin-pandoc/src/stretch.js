// Stretches printed as written: where the two parsers read a stretch of the
// document differently, no smaller piece of it reads the same to both.

import { lineSpans } from './text.js';

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */

const within = (inner, outer) =>
  inner !== outer && inner.start >= outer.start && inner.end <= outer.end;

// The start and end of the list a top-level item belongs to: every top-level
// item beside it with only blank lines between.
function listAround(item, top, text) {
  const adjacent = (a, b) =>
    a.type === 'list-item' &&
    b.type === 'list-item' &&
    /^\s*$/.test(text.slice(a.end, b.start));
  let [first, last] = [top.indexOf(item), top.indexOf(item)];
  while (first > 0 && adjacent(top[first - 1], top[first])) first--;
  while (last + 1 < top.length && adjacent(top[last], top[last + 1])) last++;
  return { start: top[first].start, end: top[last].end };
}

/**
 * The stretch of the document a misread container sits in, as a verbatim
 * block: its outermost container, and for a list item the whole list. No
 * smaller piece of it reads the same to both parsers.
 *
 * @param {Block} container
 * @param {Block[]} containers
 * @param {string} text
 * @returns {Block}
 */
function stretchOf(container, containers, text) {
  const top = containers.filter((c) => !containers.some((o) => within(c, o)));
  const outermost = top.find((c) => c === container || within(container, c));
  const { start, end } =
    outermost.type === 'list-item'
      ? listAround(outermost, top, text)
      : outermost;
  return {
    type: 'verbatim',
    start,
    end,
    segments: lineSpans(text, start, end),
  };
}

const lineStart = (text, offset) => text.lastIndexOf('\n', offset - 1) + 1;

// Whether two siblings sit on adjacent lines, no blank line between.
const joined = (a, b) => a.position.end.line + 1 === b.position.start.line;

// The top-level blocks around the one holding `offset`, joined to it with no
// blank line between: one paragraph to Pandoc, whatever CommonMark made of
// them.
function joinedAround(ast, offset, text) {
  const blocks = ast.children;
  const at = blocks.findIndex(
    (b) => b.position.start.offset <= offset && offset < b.position.end.offset,
  );
  let [first, last] = [at, at];
  while (first > 0 && joined(blocks[first - 1], blocks[first])) first--;
  while (last + 1 < blocks.length && joined(blocks[last], blocks[last + 1]))
    last++;
  const start = lineStart(text, blocks[first].position.start.offset);
  // A fence never closed runs through the file's last newline, which the
  // printer writes again.
  const until = blocks[last].position.end.offset;
  const end = start + text.slice(start, until).trimEnd().length;
  return {
    type: 'verbatim',
    start,
    end,
    segments: lineSpans(text, start, end),
  };
}

/**
 * The stretch around a misread at `offset`, as a verbatim block: inside one
 * of the recognizer's containers, its outermost container, and for a list
 * item the whole list; elsewhere the top-level block holding it, with every
 * block joined to it.
 *
 * @param {number} offset
 * @param {object} ast
 * @param {Block[]} containers
 * @param {string} text
 * @returns {Block}
 */
export function stretchAround(offset, ast, containers, text) {
  const holder = containers.find((c) => c.start <= offset && offset < c.end);
  return holder === undefined
    ? joinedAround(ast, offset, text)
    : stretchOf(holder, containers, text);
}
