// Lines a paragraph's inline constructs hold.
//
// Pandoc reads a paragraph's inlines before asking a line whether it opens a
// block, so a construct spanning lines holds them, whatever they would open:
// a comment, code span, inline math, command or link destination; a comment
// or inline tag past blank lines too. In list-item context a code span stops
// short of a line opening a list, and a block-level tag holds nothing.

import { startsCommand } from '../command.js';
import { opaqueEnd } from '../opaque.js';
import { opensList } from './container.js';
import { opensBlockTag } from './html.js';
import { pastCommand, pastInlines } from './raw-tex.js';

/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../syntax.js').Syntax} Syntax */

// What may open a construct spanning lines, or hide one.
const HOLDS = /[`$<\\[]/;

const BACKTICKS = /`+/y;

// Past the construct opening at `i`, as Pandoc reads it before any line can
// open a block.
function past(text, i, to) {
  if (text[i] === '[') return pastInlines(text, i, to);
  if (startsCommand(text, i)) return pastCommand(text, i);
  // An escaped newline is a line break, on its line.
  if (text[i] === '\\') return text[i + 1] === '\n' ? i + 1 : i + 2;
  const end = opaqueEnd(text, i);
  return end > i ? end : i + 1;
}

/**
 * What the inline constructs of a document's paragraphs hold, asked of each
 * paragraph line in turn: the text is read once, and walked once, onward from
 * the line asked last. A line read again mid-line keeps its offsets in it.
 *
 * @param {Line[]} lines
 * @param {Syntax} syntax
 * @param {boolean} inItem Whether `lines` are in list-item context.
 */
export function holding(lines, syntax, inItem) {
  /** @type {{text: string, at: number[], start: number[]} | undefined} */
  let doc;
  let cursor = 0;

  const read = () => {
    const at = [];
    const start = [];
    let text = '';
    for (const line of lines) {
      at.push(text.length);
      start.push(line.start);
      text += `${line.text}\n`;
    }
    return { text, at, start };
  };

  // The line holding offset `i` of `doc`.
  const lineOf = (i) => {
    let [lo, hi] = [0, doc.at.length - 1];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (doc.at[mid] <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const endOf = (k) =>
    doc.at[k] + lines[k].text.length + lines[k].start - doc.start[k];

  // Whether a code span from line `k` to line `j` crosses a line Pandoc reads
  // as opening a list there.
  const cutShort = (k, j) => {
    if (!inItem) return false;
    for (let m = k + 1; m <= j; m++) {
      if (opensList(lines[m].text, syntax)) return true;
    }
    return false;
  };

  return {
    /**
     * The line the first construct running past paragraph line `n` ends on,
     * read from where the last one asked of ended; `n` when none does. On the
     * line it ends on, what follows is asked of next.
     *
     * @param {number} n
     * @returns {number}
     */
    through(n) {
      if (!HOLDS.test(lines[n].text)) return n;
      doc ??= read();
      const { text } = doc;
      const to = endOf(n);
      let i = Math.max(cursor, doc.at[n] + lines[n].start - doc.start[n]);
      while (i < to) {
        if (text[i] === '<' && opensBlockTag(text, i)) {
          i++;
          continue;
        }
        const end = past(text, i, to);
        if (end > to) {
          const j = lineOf(end);
          if (text[i] !== '`' || !cutShort(n, j)) {
            cursor = end;
            return j;
          }
          BACKTICKS.lastIndex = i;
          BACKTICKS.test(text);
          i = BACKTICKS.lastIndex;
          continue;
        }
        i = end;
      }
      cursor = i;
      return n;
    },
  };
}
