// Line and column of an offset, on demand: parsers carry offsets only.
//
// Columns count as Pandoc's input stream counts them — from 1, a code point
// each, a tab to the next tab stop at 1 plus a multiple of 4 — which is what
// Pandoc's logic reads where it reads one. Only a line feed starts a line.

import { codePointLength } from './code-points.js';

const TAB = 4;

// The column after the character `code` at `column`.
const nextColumn = (column, code) => {
  if (code === 0x0a) return 1;
  if (code === 0x09) return column + TAB - ((column - 1) % TAB);
  return column + 1;
};

// Each offset's column: offsets inside a surrogate pair share the pair's.
function columnsOf(text) {
  const columns = new Int32Array(text.length + 1);
  let column = 1;
  for (let i = 0; i < text.length; ) {
    const length = codePointLength(text, i);
    for (let k = 0; k < length; k++) columns[i + k] = column;
    column = nextColumn(column, text.charCodeAt(i));
    i += length;
  }
  columns[text.length] = column;
  return columns;
}

/**
 * The column of `offset`, counted from its line's start: for a column or
 * two, where indexing the whole text would not pay.
 *
 * @see Text.Pandoc.Sources.updateSourcePos
 * @param {string} text
 * @param {number} offset
 */
export function columnOf(text, offset) {
  let column = 1;
  for (let i = text.lastIndexOf('\n', offset - 1) + 1; i < offset; ) {
    column = nextColumn(column, text.charCodeAt(i));
    i += codePointLength(text, i);
  }
  return column;
}

/**
 * The positions in `text`, indexed once: lines at once, columns on first
 * asking.
 *
 * @see Text.Pandoc.Sources.updateSourcePos
 * @param {string} text
 */
export function positions(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  /** @type {Int32Array | undefined} */
  let columns;

  // The index of the line holding `offset`.
  const lineOf = (offset) => {
    let [lo, hi] = [0, starts.length - 1];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return {
    /**
     * The line and column of `offset`.
     *
     * @see Text.Parsec.Pos.SourcePos
     * @param {number} offset In UTF-16 code units.
     * @returns {{line: number, column: number}} Both from 1.
     */
    locate(offset) {
      columns ??= columnsOf(text);
      return { line: lineOf(offset) + 1, column: columns[offset] };
    },

    /**
     * The offset `line` starts at: with `locate`, what an editor's position
     * (line, UTF-16 character) needs.
     *
     * @param {number} line From 1.
     * @returns {number}
     */
    lineStart: (line) => starts[line - 1],
  };
}
