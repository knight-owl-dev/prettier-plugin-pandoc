// The LaTeX reader's parsing toolkit: TeX tokenized, and tokens written
// back as text.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Parsing`.

import { isAlphaNum, isAlpha as isLetter } from '../data-char.js';
import { readInt } from '../parsing/lists.js';

/** @typedef {import('../tex.js').Tok} Tok */

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isSpaceOrTab */
const isSpaceOrTab = (c) => c === ' ' || c === '\t';

/**
 * A letter, or `@` where `\makeatletter` made it one.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.isLetter'
 * @param {boolean} atIsLetter
 * @param {string} c
 */
const isLetterOrAt = (atIsLetter, c) =>
  (atIsLetter && c === '@') || isLetter(c);

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isLowerHex */
const isLowerHex = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');

const isDigit = (c) => c >= '0' && c <= '9';

/**
 * The tokens of `text` from `from`, the first at Pandoc's position `line`
 * and `column`, made on demand: a consumer of the first ones tokenizes no
 * further. Positions move as Pandoc's do, drifts and all: a control space
 * before a non-blank line, `##` without digits, and `^^` before a newline
 * leave later positions behind the text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.tokenize
 * @param {string} text
 * @param {number} [from]
 * @param {{line: number, column: number}} [start]
 * @returns {Generator<Tok>}
 */
export function* tokenize(text, from = 0, start = { line: 1, column: 1 }) {
  let { line, column } = start;
  let at = from;
  let atIsLetter = false;
  // The code point at `i`; null at the end.
  const charAt = (i) =>
    i < text.length ? String.fromCodePoint(text.codePointAt(i)) : null;
  // Where the run of characters `test` holds of ends, and how many.
  const span = (i, test) => {
    let n = 0;
    for (let c = charAt(i); c !== null && test(c); c = charAt(i)) {
      i += c.length;
      n++;
    }
    return [i, n];
  };
  const tok = (type, s, e, extra) => ({
    type,
    text: text.slice(s, e),
    ...extra,
    line,
    column,
    start: s,
    end: e,
  });

  while (at < text.length) {
    const c = charAt(at);
    const rest = at + c.length;
    if (c === '\n') {
      yield tok('Newline', at, rest);
      [line, column, at] = [line + 1, 1, rest];
    } else if (isSpaceOrTab(c)) {
      const [end, n] = span(at, isSpaceOrTab);
      yield tok('Spaces', at, end);
      [column, at] = [column + n, end];
    } else if (isAlphaNum(c)) {
      const [end, n] = span(at, isAlphaNum);
      yield tok('Word', at, end);
      [column, at] = [column + n, end];
    } else if (c === '%') {
      const nl = text.indexOf('\n', rest);
      const end = nl === -1 ? text.length : nl;
      yield tok('Comment', at, end);
      [column, at] = [column + 1 + codePoints(text, rest, end), end];
    } else if (c === '\\') {
      const d = charAt(rest);
      if (d === null) {
        yield tok('CtrlSeq', at, rest, { name: ' ' });
        return;
      }
      if (isLetterOrAt(atIsLetter, d)) {
        const [wordEnd, wn] = span(rest, (x) => isLetterOrAt(atIsLetter, x));
        const [end, sn] = span(wordEnd, isSpaceOrTab);
        const name = text.slice(rest, wordEnd);
        yield tok('CtrlSeq', at, end, { name });
        if (name === 'makeatletter') atIsLetter = true;
        else if (name === 'makeatother') atIsLetter = false;
        [column, at] = [column + 1 + wn + sn, end];
      } else if (isSpaceOrTab(d) || d === '\n') {
        // A control space: `\`, spaces, a newline and the next line's
        // leading spaces. Before a blank line, `\` and its spaces alone.
        const [r1, n1] = span(rest, isSpaceOrTab);
        let [r3, n2, n3] = [r1, 0, 0];
        if (text[r1] === '\n') {
          [r3, n3] = span(r1 + 1, isSpaceOrTab);
          n2 = 1;
        }
        const width = 1 + n1 + n2 + n3;
        if (text[r3] === '\n') {
          yield tok('CtrlSeq', at, r1, { name: ' ' });
          [column, at] = [column + width, r1];
        } else {
          // Pandoc's position misses the newline: later lines drift.
          yield tok('CtrlSeq', at, r3, { name: ' ' });
          [column, at] = [column + width, r3];
        }
      } else {
        const end = rest + d.length;
        yield tok('CtrlSeq', at, end, { name: d });
        [column, at] = [column + 2, end];
      }
    } else if (c === '#') {
      if (text[rest] === '#') {
        const [end, n] = span(rest + 1, isDigit);
        if (n > 0) {
          const arg = readInt(text.slice(rest + 1, end));
          yield tok('DeferredArg', at, end, { arg });
          [column, at] = [column + 2 + n, end];
        } else {
          // Two symbols, the position past the first only: the rest of
          // the line drifts a column.
          yield tok('Symbol', at, rest);
          column++;
          yield tok('Symbol', rest, rest + 1);
          at = rest + 1;
        }
      } else {
        const [end, n] = span(rest, isDigit);
        if (n > 0) {
          const arg = readInt(text.slice(rest, end));
          yield tok('Arg', at, end, { arg });
          [column, at] = [column + 1 + n, end];
        } else {
          yield tok('Symbol', at, rest);
          [column, at] = [column + 1, rest];
        }
      }
    } else if (c === '^') {
      const d = text[rest] === '^' ? charAt(rest + 1) : null;
      if (text[rest] !== '^') {
        yield tok('Symbol', at, rest);
        [column, at] = [column + 1, rest];
      } else if (
        d !== null &&
        isLowerHex(d) &&
        isLowerHex(text[rest + 2] ?? '')
      ) {
        yield tok('Esc2', at, rest + 3);
        [column, at] = [column + 4, rest + 3];
      } else if (d !== null && (isLowerHex(d) || d.codePointAt(0) < 0x80)) {
        // `^^` and a newline too: Pandoc's position misses it.
        const end = rest + 1 + d.length;
        yield tok('Esc1', at, end);
        [column, at] = [column + 3, end];
      } else {
        yield tok('Symbol', at, rest);
        column++;
        yield tok('Symbol', rest, rest + 1);
        [column, at] = [column + 1, rest + 1];
      }
    } else {
      yield tok('Symbol', at, rest);
      [column, at] = [column + 1, rest];
    }
  }
}

// How many code points `text` has from `start` to `end`.
function codePoints(text, start, end) {
  let n = 0;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code < 0xdc00 || code > 0xdfff) n++;
  }
  return n;
}

/**
 * Tokens as text: a space after a control word before a letter, where
 * writing them together would make one control word.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.untokenize
 * @param {Iterable<Tok>} toks
 */
export function untokenize(toks) {
  const list = [...toks];
  let out = '';
  for (let k = list.length - 1; k >= 0; k--) out = untokenAccum(list[k], out);
  return out;
}

/**
 * One token as text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.untoken
 * @param {Tok} tok
 */
export const untoken = (tok) => untokenAccum(tok, '');

// A token's text before `accum`: a control sequence ending in a letter
// spaced from a letter after it.
// @see Text.Pandoc.Readers.LaTeX.Parsing.untokenAccum
function untokenAccum(tok, accum) {
  const { text } = tok;
  if (tok.type === 'CtrlSeq') {
    const last = [...text].at(-1);
    const first =
      accum === '' ? undefined : String.fromCodePoint(accum.codePointAt(0));
    if (
      last !== undefined &&
      first !== undefined &&
      isLetter(last) &&
      isLetter(first)
    ) {
      return `${text} ${accum}`;
    }
  }
  return text + accum;
}
