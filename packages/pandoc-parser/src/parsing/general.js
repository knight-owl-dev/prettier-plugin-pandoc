// General parsers of Pandoc's toolkit, as its readers compose them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.General`.

import * as B from '../ast/builder.js';
import { mapSpans } from '../ast/spans.js';
import { char, newline, satisfy, space } from '../char.js';
import {
  attempt,
  FAIL,
  many1,
  manyTill,
  notFollowedBy,
  optional,
  skipMany,
} from '../core.js';
import { lookupEntity } from '../entities.js';
import { uniqueIdent } from '../shared.js';
import { enabled, updateState } from './state.js';

/** @typedef {import('../core.js').Context} Context */
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

/** Blank lines, or none: Haskell's `optional blanklines`. */
export const optionalBlanklines = optional(blanklines);

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

/**
 * A line, its newline read and left out.
 *
 * @see Text.Pandoc.Parsing.General.anyLine
 * @type {Parser<string>}
 */
export function anyLine(ctx) {
  const { text, pos } = ctx;
  const end = text.indexOf('\n', pos);
  if (end === -1) return FAIL;
  ctx.pos = end + 1;
  return text.slice(pos, end);
}

/**
 * A line, its newline kept.
 *
 * @see Text.Pandoc.Parsing.General.anyLineNewline
 * @type {Parser<string>}
 */
export function anyLineNewline(ctx) {
  const line = anyLine(ctx);
  return line === FAIL ? FAIL : `${line}\n`;
}

/**
 * Exactly `n` spaces, or nothing read. Pandoc expands a tab here; the
 * reader's input holds none.
 *
 * @see Text.Pandoc.Parsing.General.gobbleSpaces
 * @param {Context} ctx
 * @param {number} n
 * @returns {undefined | typeof FAIL}
 */
export function gobbleSpaces(ctx, n) {
  for (let k = 0; k < n; k++) {
    if (ctx.text[ctx.pos + k] !== ' ') return FAIL;
  }
  ctx.pos += n;
  return undefined;
}

/**
 * Up to `n` spaces: how many. Pandoc expands a tab here; the reader's input
 * holds none.
 *
 * @see Text.Pandoc.Parsing.General.gobbleAtMostSpaces
 * @param {Context} ctx
 * @param {number} n
 * @returns {number}
 */
export function gobbleAtMostSpaces(ctx, n) {
  let k = 0;
  while (k < n && ctx.text[ctx.pos] === ' ') {
    ctx.pos++;
    k++;
  }
  return k;
}

/**
 * The attributes of a heading of `inlines`: with `auto_identifiers`, an
 * identifier made from its text where it has none; either way recorded as
 * used.
 *
 * Not ported yet: `ascii_identifiers`, off by default, and the warning of a
 * duplicate identifier.
 *
 * @see Text.Pandoc.Parsing.General.registerHeader
 * @param {Context} ctx
 * @param {import('./state.js').Attr} attr
 * @param {import('../ast/nodes.js').Node[]} inlines
 * @returns {import('./state.js').Attr}
 */
export function registerHeader(ctx, [ident, classes, pairs], inlines) {
  const used = ctx.state.identifiers;
  const id =
    ident === '' && enabled(ctx, 'auto_identifiers')
      ? uniqueIdent(inlines, used)
      : ident;
  if (id !== '') updateState(ctx, { identifiers: used.set(id, true) });
  return [id, classes, pairs];
}

/**
 * Where the line holding `pos` ends: its newline, or the text's end.
 *
 * @param {string} text
 * @param {number} pos
 */
export function lineEnd(text, pos) {
  const end = text.indexOf('\n', pos);
  return end === -1 ? text.length : end;
}

/**
 * `parser` run on `source`, text extracted to be parsed again, in its own
 * offsets; the nodes it returns spanning the text `source` was extracted
 * from, carriage returns left out of it as Pandoc's `toSources` leaves them.
 * A failure leaves the position where the extraction left it. The chunk is
 * one level deeper: Parsec's source name, which positions compare by.
 *
 * @see Text.Pandoc.Parsing.General.parseFromString
 * @template T
 * @param {Context} ctx
 * @param {Parser<T>} parser
 * @param {import('../source-text.js').SourceText} extracted
 * @returns {T | typeof FAIL}
 */
export function parseFromString(ctx, parser, extracted) {
  const source = extracted.withoutCarriageReturns();
  const { text, pos, depth = 0 } = ctx;
  ctx.text = source.text;
  ctx.pos = 0;
  ctx.depth = depth + 1;
  const x = parser(ctx);
  ctx.text = text;
  ctx.pos = pos;
  ctx.depth = depth;
  if (x === FAIL) return FAIL;
  return mapSpans(
    x,
    (offset) => source.toOuterStart(offset),
    (offset) => source.toOuterEnd(offset),
  );
}

/**
 * `parseFromString` with no `str` before it, the one outside kept for after.
 *
 * @see Text.Pandoc.Parsing.General.parseFromString'
 * @template T
 * @param {Context} ctx
 * @param {Parser<T>} parser
 * @param {import('../source-text.js').SourceText} source
 * @returns {T | typeof FAIL}
 */
export function parseFromStringFresh(ctx, parser, source) {
  const outer = ctx.state.lastStrPos;
  updateState(ctx, { lastStrPos: null });
  const x = parseFromString(ctx, parser, source);
  updateState(ctx, { lastStrPos: outer });
  return x;
}

// A line of spaces and tabs alone: `blankline`'s, not every Unicode space.
const BLANK = /^[ \t]*$/;

/**
 * Where what was read from `from` to `to` ends as a block: its last line
 * not blank, the newline left out.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} to
 */
export function lastLineEnd(text, from, to) {
  let end = to;
  for (;;) {
    while (end > from && text[end - 1] === '\n') end--;
    const lineStart = text.lastIndexOf('\n', end - 1) + 1;
    if (lineStart <= from || !BLANK.test(text.slice(lineStart, end))) {
      return end;
    }
    end = lineStart;
  }
}

/**
 * Where a block read from `from` to `to` ends: its last line not blank,
 * or where its last child does, whichever is later; a line break the block
 * keeps at its end spans the newline.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @param {import('../ast/nodes.js').Node[]} children
 */
export function blockEnd(text, from, to, children) {
  return Math.max(lastLineEnd(text, from, to), children.at(-1)?.end ?? from);
}
