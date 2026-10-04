// Character classes as GHC's `Data.Char` has them: by range in ASCII, by
// Unicode general category past it. A leaf module: the parser and the
// libraries ported beside it test characters alike.
//
// Ported from GHC's `Data.Char` (base).

// ASCII decided by range, the rest by Unicode general category.
const ascii = (c) => c.length === 1 && c.charCodeAt(0) < 0x80;
const inRange = (c, lo, hi) => c >= lo && c <= hi;

const LETTER = /^\p{L}$/u;
const NUMBER = /^\p{N}$/u;
const UPPER = /^[\p{Lu}\p{Lt}]$/u;
const LOWER = /^\p{Ll}$/u;
const SEPARATOR = /^\p{Zs}$/u;

/**
 * A space: in Latin-1, a space, tab, line feed, vertical tab, form feed,
 * carriage return or no-break space; past it, a space separator (Zs).
 *
 * @see Data.Char.isSpace
 * @param {string} c
 */
export function isSpace(c) {
  const code = c.codePointAt(0);
  if (code <= 0x377) {
    return code === 0x20 || (code >= 0x9 && code <= 0xd) || code === 0xa0;
  }
  return SEPARATOR.test(c);
}

/**
 * An ASCII digit.
 *
 * @see Data.Char.isDigit
 * @param {string} c
 */
export const isDigit = (c) => c.length === 1 && inRange(c, '0', '9');

/**
 * An upper or title case letter (Lu, Lt).
 *
 * @see Data.Char.isUpper
 * @param {string} c
 */
export const isUpper = (c) => (ascii(c) ? inRange(c, 'A', 'Z') : UPPER.test(c));

/**
 * A lower case letter (Ll).
 *
 * @see Data.Char.isLower
 * @param {string} c
 */
export const isLower = (c) => (ascii(c) ? inRange(c, 'a', 'z') : LOWER.test(c));

/**
 * A letter (L).
 *
 * @see Data.Char.isAlpha
 * @param {string} c
 */
export const isAlpha = (c) =>
  ascii(c) ? inRange(c, 'a', 'z') || inRange(c, 'A', 'Z') : LETTER.test(c);

/**
 * A letter or number (L, N).
 *
 * @see Data.Char.isAlphaNum
 * @param {string} c
 */
export const isAlphaNum = (c) =>
  ascii(c) ? isAlpha(c) || isDigit(c) : LETTER.test(c) || NUMBER.test(c);

/**
 * A character in lower case by Unicode's simple mapping, one character to
 * one: where JavaScript's full mapping gives more, the character itself,
 * but `İ`, whose simple mapping is `i`.
 *
 * @see Data.Char.toLower
 * @param {string} c
 */
export function toLower(c) {
  const full = c.toLowerCase();
  if (full.length === c.length || [...full].length === 1) return full;
  return c === 'İ' ? 'i' : c;
}

/**
 * A character in upper case by Unicode's simple mapping: where
 * JavaScript's full mapping gives more characters (`ß`), the character
 * itself.
 *
 * @see Data.Char.toUpper
 * @param {string} c
 */
export function toUpper(c) {
  const full = c.toUpperCase();
  return [...full].length === 1 ? full : c;
}
