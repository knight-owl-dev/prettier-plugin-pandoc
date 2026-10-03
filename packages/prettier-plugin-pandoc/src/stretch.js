// Stretches printed as written: where the two parsers read a stretch of the
// document differently, no smaller piece of it reads the same to both.

import { lineEnd, lineSpans, stopOf } from './text.js';

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

const BLANK_LINE = /\n[ \t]*\n/;

// Whether no blank line separates two siblings in the text prettier parsed, a
// div's fences blank there. Positions can't tell: indented code runs over the
// blank lines after it.
const joined = (a, b, masked) =>
  !BLANK_LINE.test(
    masked.slice(
      stopOf(masked, a.position.start.offset, a.position.end.offset),
      b.position.start.offset,
    ),
  );

// The top-level blocks from the one holding `start` to the one holding `end`,
// and those joined to them with no blank line between: one paragraph to
// Pandoc, whatever CommonMark made of them.
function joinedAround(ast, { start, end }, text, masked) {
  const blocks = ast.children;
  // The last block starting at or before `offset`: the one holding it, or
  // the one before the blank lines it falls in.
  const holding = (offset) =>
    Math.max(
      0,
      blocks.findLastIndex((b) => b.position.start.offset <= offset),
    );
  let [first, last] = [holding(start), holding(Math.max(start, end - 1))];
  while (first > 0 && joined(blocks[first - 1], blocks[first], masked)) first--;
  while (
    last + 1 < blocks.length &&
    joined(blocks[last], blocks[last + 1], masked)
  )
    last++;
  const from = lineStart(text, blocks[first].position.start.offset);
  // A block ends on the line its content stops on, short of indented code's
  // blank lines and a fence never closed. A misread's end may lie on a line
  // the mask blanked, past every block.
  const { position } = blocks[last];
  const until = Math.max(
    lineStop(text, stopOf(masked, position.start.offset, position.end.offset)),
    end,
  );
  const to = from + text.slice(from, until).trimEnd().length;
  return {
    type: 'verbatim',
    start: from,
    end: to,
    segments: lineSpans(text, from, to),
  };
}

/**
 * The stretch around a misread, as a verbatim block: inside one of the
 * recognizer's containers, its outermost container, and for a list item the
 * whole list; elsewhere, or where the misread runs past that, the top-level
 * blocks it spans, with every block joined to them.
 *
 * @param {{start: number, end: number}} misread
 * @param {object} ast
 * @param {{containers: Block[], verbatim: Block[], divs: Block[]}} constructs
 * @param {string} text
 * @param {string} masked The text prettier parsed to `ast`.
 * @returns {Block}
 */
export function stretchAround(
  misread,
  ast,
  { containers, verbatim, divs },
  text,
  masked,
) {
  const whole = { blocks: [...verbatim, ...containers], divs };
  const holder = containers.find(
    (c) => c.start <= misread.start && misread.start < c.end,
  );
  if (holder !== undefined) {
    const stretch = stretchOf(holder, containers, text);
    if (misread.end <= stretch.end) return widen(stretch, whole, text);
  }
  return widen(joinedAround(ast, misread, text, masked), whole, text);
}

// The end of the line `at` is on, short of its trailing spaces.
function lineStop(text, at) {
  const from = lineStart(text, at);
  return from + text.slice(from, lineEnd(text, at)).trimEnd().length;
}

// `stretch` grown to hold each block it cuts into, whole lines and all, and
// both fences of each div it holds one of: withStretch drops a construct
// starting inside it, and two masks over one line print it twice. A div whose
// fences lie outside needs none: the mask blanks them.
function widen(stretch, { blocks, divs }, text) {
  let { start, end } = stretch;
  const cut = (b) =>
    b.start < end &&
    start < b.end &&
    (b.start < start || stopOf(text, b.start, b.end) > end);
  const holds = (fence) => start <= fence.start && fence.start < end;
  const cutDiv = (d) => d.close !== null && holds(d.open) !== holds(d.close);
  for (;;) {
    const block = blocks.find(cut);
    const div = divs.find(cutDiv);
    if (block === undefined && div === undefined) break;
    const { start: from, end: to } = block ?? {
      start: div.open.start,
      end: div.close.end,
    };
    start = Math.min(start, lineStart(text, from));
    end = Math.max(end, lineStop(text, to));
  }
  if (start === stretch.start && end === stretch.end) return stretch;
  return {
    type: 'verbatim',
    start,
    end,
    segments: lineSpans(text, start, end),
  };
}
