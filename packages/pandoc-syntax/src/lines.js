// Lines of a document, and the views a container's content is read through.
//
// A line records where its text starts and ends in the source. A view of it —
// its indentation or a quote marker removed — moves `start` with the text, so
// an offset found through any view is still an offset into the source.

/** @typedef {import('./types.js').Line} Line */
/** @typedef {import('./types.js').Span} Span */

export const BLANK = /^[ \t]*$/;

/**
 * Split a document into its lines, newlines excluded.
 *
 * @param {string} text
 * @returns {Line[]}
 */
export function splitLines(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    lines.push({ start, end, text: text.slice(start, end) });
    if (newline === -1) return lines;
    start = newline + 1;
  }
}

// The column after `char`, read at `col`: a tab advances to the next multiple
// of `tabStop`. Null for a character that is not indentation.
function advance(col, char, tabStop) {
  if (char === ' ') return col + 1;
  if (char === '\t') return col + tabStop - (col % tabStop);
  return null;
}

/**
 * The column a line's text starts at.
 *
 * @param {string} text
 * @param {number} tabStop
 * @returns {number}
 */
export function indentOf(text, tabStop) {
  let col = 0;
  for (const char of text) {
    const next = advance(col, char, tabStop);
    if (next === null) break;
    col = next;
  }
  return col;
}

/**
 * A view of `line` with up to `cols` columns of its indentation removed.
 *
 * @param {Line} line
 * @param {number} cols
 * @param {number} tabStop
 * @returns {Line}
 */
export function dedent(line, cols, tabStop) {
  let col = 0;
  let i = 0;
  while (i < line.text.length && col < cols) {
    const next = advance(col, line.text[i], tabStop);
    if (next === null) break;
    col = next;
    i++;
  }
  return { start: line.start + i, end: line.end, text: line.text.slice(i) };
}

/**
 * A view of `line` with its first `chars` characters removed.
 *
 * @param {Line} line
 * @param {number} chars
 * @returns {Line}
 */
export function strip(line, chars) {
  return {
    start: line.start + chars,
    end: line.end,
    text: line.text.slice(chars),
  };
}

/**
 * Each line's share of a span from `start` on line `from` to `end` on line
 * `to`: what a caller masks, line by line, without touching a container's
 * prefix between them.
 *
 * @param {Line[]} lines
 * @param {number} from
 * @param {number} to
 * @param {number} start
 * @param {number} end
 * @returns {Span[]}
 */
export function segmentsOf(lines, from, to, start, end) {
  return lines.slice(from, to + 1).map((line, k) => ({
    start: k === 0 ? start : line.start,
    end: k === to - from ? end : line.end,
  }));
}

/**
 * Whether the newline at `at` is followed by a blank line: the break that ends
 * a paragraph, and every inline construct open in it.
 *
 * @param {string} text
 * @param {number} at The offset of a newline.
 * @returns {boolean}
 */
export function breaksParagraph(text, at) {
  const next = text.indexOf('\n', at + 1);
  return BLANK.test(text.slice(at + 1, next === -1 ? text.length : next));
}
