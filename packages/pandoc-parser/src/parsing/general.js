// General parsers of Pandoc's toolkit, as its readers compose them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.General`.

import { newline, satisfy } from '../char.js';
import { attempt, FAIL, many1, manyTill, skipMany } from '../core.js';

/** @template T @typedef {import('../core.js').Parser<T>} Parser */

/**
 * A space, tab, line feed or carriage return.
 *
 * @see Text.Pandoc.Parsing.General.isSpaceChar
 * @param {string} c
 */
export const isSpaceChar = (c) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * A space or a tab.
 *
 * @see Text.Pandoc.Parsing.General.spaceChar
 */
export const spaceChar = satisfy((c) => c === ' ' || c === '\t');

/**
 * Zero or more spaces or tabs.
 *
 * @see Text.Pandoc.Parsing.General.skipSpaces
 */
export const skipSpaces = skipMany(spaceChar);

/**
 * Spaces or tabs, then a newline.
 *
 * @see Text.Pandoc.Parsing.General.blankline
 */
export const blankline = attempt((ctx) =>
  skipSpaces(ctx) === FAIL ? FAIL : newline(ctx),
);

/**
 * One or more blank lines.
 *
 * @see Text.Pandoc.Parsing.General.blanklines
 */
export const blanklines = many1(blankline);

/**
 * Succeed where `p` fails, reading nothing. Unlike Parsec's `notFollowedBy`,
 * a `p` that succeeds without consuming fails it too.
 *
 * @see Text.Pandoc.Parsing.General.notFollowedBy'
 * @param {Parser<unknown>} p
 * @returns {Parser<undefined>}
 */
export function notAhead(p) {
  return (ctx) => {
    const { pos, state } = ctx;
    const x = p(ctx);
    ctx.pos = pos;
    ctx.state = state;
    return x === FAIL ? undefined : FAIL;
  };
}

/**
 * One or more of `p` until `end`, which may not succeed first.
 *
 * @see Text.Pandoc.Parsing.General.many1Till
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} end
 * @returns {Parser<T[]>}
 */
export function many1Till(p, end) {
  const notEnd = notAhead(end);
  const rest = manyTill(p, end);
  return (ctx) => {
    if (notEnd(ctx) === FAIL) return FAIL;
    const first = p(ctx);
    if (first === FAIL) return FAIL;
    const xs = rest(ctx);
    return xs === FAIL ? FAIL : [first, ...xs];
  };
}
