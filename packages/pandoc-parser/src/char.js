// Parsec's character parsers, and the character predicates they test with.
//
// Ported from parsec 3.1.17's `Text.Parsec.Char`, the parsec Pandoc 3.11
// builds with. Like Pandoc's input stream, they read a code point at a time;
// offsets stay UTF-16 code units.

import { codePointLength } from './code-points.js';
import { FAIL, skipMany } from './core.js';
import {
  isAlpha,
  isAlphaNum,
  isDigit,
  isLower,
  isSpace,
  isUpper,
} from './data-char.js';

export { isAlpha, isAlphaNum, isDigit, isLower, isSpace, isUpper };

/** @template T @typedef {import('./core.js').Parser<T>} Parser */

// The code point at `pos`, as a string.
const charAt = (text, pos) =>
  codePointLength(text, pos) === 1 ? text[pos] : text.slice(pos, pos + 2);

/**
 * The next character, where `test` holds of it; fails without consuming
 * otherwise, or at the end.
 *
 * @see Text.Parsec.Char.satisfy
 * @param {(c: string) => boolean} test
 * @returns {Parser<string>}
 */
export function satisfy(test) {
  return (ctx) => {
    const { text, pos } = ctx;
    if (pos >= text.length) return FAIL;
    const c = charAt(text, pos);
    if (!test(c)) return FAIL;
    ctx.pos = pos + c.length;
    return c;
  };
}

/**
 * Any character.
 *
 * @see Text.Parsec.Char.anyChar
 * @type {Parser<string>}
 */
export const anyChar = satisfy(() => true);

/**
 * The character `c`: `string` of one code point.
 *
 * @see Text.Parsec.Char.char
 * @param {string} c
 * @returns {Parser<string>}
 */
export const char = (c) => string(c);

/**
 * Any character of `cs`.
 *
 * @see Text.Parsec.Char.oneOf
 * @param {string} cs
 * @returns {Parser<string>}
 */
export function oneOf(cs) {
  const set = new Set(cs);
  return satisfy((c) => set.has(c));
}

/**
 * Any character not in `cs`.
 *
 * @see Text.Parsec.Char.noneOf
 * @param {string} cs
 * @returns {Parser<string>}
 */
export function noneOf(cs) {
  const set = new Set(cs);
  return satisfy((c) => !set.has(c));
}

/**
 * The text `s`. Matching its first character consumes it, so a mismatch
 * after that is a consuming failure, as in Parsec's `tokens`.
 *
 * @see Text.Parsec.Char.string
 * @see Text.Parsec.Prim.tokens
 * @param {string} s
 * @returns {Parser<string>}
 */
export function string(s) {
  const first = s.slice(0, codePointLength(s, 0));
  return (ctx) => {
    const { text, pos } = ctx;
    if (matchesAt(text, pos, s)) {
      ctx.pos = pos + s.length;
      return s;
    }
    // Consumed where its first character matched.
    if (s.length > first.length && matchesAt(text, pos, first)) {
      ctx.pos = pos + first.length;
    }
    return FAIL;
  };
}

// Whether `s` is at `pos`, ending on a code point's end, not mid-pair.
const matchesAt = (text, pos, s) =>
  text.startsWith(s, pos) && !splitsPair(text, pos + s.length);

// Whether `end` falls inside a surrogate pair.
const splitsPair = (text, end) =>
  end > 0 && codePointLength(text, end - 1) === 2;

/** @see Text.Parsec.Char.space */
export const space = satisfy(isSpace);

/** @see Text.Parsec.Char.letter */
export const letter = satisfy(isAlpha);

/** @see Text.Parsec.Char.digit */
export const digit = satisfy(isDigit);

/** @see Text.Parsec.Char.alphaNum */
export const alphaNum = satisfy(isAlphaNum);

/** @see Text.Parsec.Char.upper */
export const upper = satisfy(isUpper);

/** @see Text.Parsec.Char.lower */
export const lower = satisfy(isLower);

/** @see Text.Parsec.Char.newline */
export const newline = char('\n');

/** @see Text.Parsec.Char.tab */
export const tab = char('\t');

/**
 * Zero or more spaces.
 *
 * @see Text.Parsec.Char.spaces
 */
export const spaces = skipMany(space);
