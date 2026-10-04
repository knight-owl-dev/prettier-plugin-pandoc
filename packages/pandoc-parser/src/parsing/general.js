// General parsers of Pandoc's toolkit, as its readers compose them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.General`.

import * as B from '../ast/builder.js';
import { char, newline, satisfy, space } from '../char.js';
import {
  attempt,
  FAIL,
  many1,
  manyTill,
  notFollowedBy,
  skipMany,
} from '../core.js';
import { lookupEntity } from '../entities.js';

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
 * Any character but a space, tab, line feed or carriage return.
 *
 * @see Text.Pandoc.Parsing.General.nonspaceChar
 */
export const nonspaceChar = satisfy((c) => !isSpaceChar(c));

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

/**
 * One or more of `p` between `start` and `end`, `start` not followed by a
 * space.
 *
 * @see Text.Pandoc.Parsing.General.enclosed
 * @template T
 * @param {Parser<unknown>} start
 * @param {Parser<unknown>} end
 * @param {Parser<T>} p
 * @returns {Parser<T[]>}
 */
export function enclosed(start, end, p) {
  const noSpace = notFollowedBy(space);
  const body = many1Till(p, end);
  return attempt((ctx) =>
    start(ctx) === FAIL || noSpace(ctx) === FAIL ? FAIL : body(ctx),
  );
}

const ampersand = char('&');
const referenceBody = many1Till(nonspaceChar, char(';'));

/**
 * A character reference, `&name;` or `&#n;`, as the text it stands for.
 *
 * @see Text.Pandoc.Parsing.General.characterReference
 * @type {Parser<string>}
 */
export const characterReference = attempt((ctx) => {
  if (ampersand(ctx) === FAIL) return FAIL;
  const body = referenceBody(ctx);
  if (body === FAIL) return FAIL;
  return lookupEntity(`${body.join('')};`) ?? FAIL;
});

/**
 * A character reference, as a `Str` of the text it stands for.
 *
 * @see Text.Pandoc.Parsing.General.charRef
 */
export function charRef(ctx) {
  const start = ctx.pos;
  const t = characterReference(ctx);
  return t === FAIL ? FAIL : B.str(t, start, ctx.pos);
}

/**
 * The text `p` reads.
 *
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<string>}
 */
export function textOf(p) {
  return (ctx) => {
    const start = ctx.pos;
    return p(ctx) === FAIL ? FAIL : ctx.text.slice(start, ctx.pos);
  };
}
