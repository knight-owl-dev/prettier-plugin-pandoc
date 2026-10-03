// Line and column of an offset, on demand: parsers carry offsets only.
//
// Columns count as parsec 3.1.17's `updatePosChar` does — from 1, a code
// point each, a tab to the next tab stop at 1 plus a multiple of 8 — which is
// what Pandoc's logic reads where it reads one. Only a line feed starts a
// line.

import { codePointLength } from './code-points.js';

/**
 * The positions in `text`, indexed once.
 *
 * @see Text.Parsec.Pos.updatePosChar
 * @param {string} text
 */
export function positions(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }

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
      const line = lineOf(offset);
      let column = 1;
      for (let i = starts[line]; i < offset; i += codePointLength(text, i)) {
        column =
          text[i] === '\t' ? column + 8 - ((column - 1) % 8) : column + 1;
      }
      return { line: line + 1, column };
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
