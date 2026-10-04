// Emphasis, strong emphasis, strikeout and highlighting: inlines between
// delimiters. Where a delimiter never closes, it is text.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. Its `three`,
// `two` and `one` read on from an opening delimiter; here each takes the
// delimiter's offset, which gives the spans: of what each closes, and of a
// delimiter left as text.

import * as B from '../ast/builder.js';
import { alphaNum, char, string } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  notFollowedBy,
  skipMany1,
} from '../core.js';
import { many1Till, nonspaceChar, notAhead } from '../parsing/general.js';
import {
  enabled,
  notAfterString,
  updateLastStrPos,
  whenEnabled,
} from '../parsing/state.js';
// `inline` and `whitespace` are function declarations, bound here whichever
// of the two modules loads first; `inlines.js` reads this module's parsers
// only when it calls them.
import { inline, whitespace } from './inlines.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../ast/inlines.js').Inlines} Inlines */

const noAlphaNum = notFollowedBy(alphaNum);

// `n` delimiters `c` that close: an underscore not before a letter or digit,
// with `intraword_underscores`.
const ender = (c, n) => {
  const run = string(c.repeat(n));
  return attempt((ctx) => {
    if (run(ctx) === FAIL) return FAIL;
    if (c === '*' || !enabled(ctx, 'intraword_underscores')) return undefined;
    return noAlphaNum(ctx);
  });
};

// The parser of emphasis delimited by `c`.
function enclosure(c) {
  const [end1, end2, end3] = [ender(c, 1), ender(c, 2), ender(c, 3)];
  const [notEnd1, notEnd2] = [notFollowedBy(end1), notFollowedBy(end2)];
  const run = skipMany1(char(c));
  const pair = string(c + c);

  // `inline`s while `notEnd` holds before each.
  const inlinesUntil = (notEnd) => (ctx) =>
    notEnd(ctx) === FAIL ? FAIL : inline(ctx);
  const threeContents = many(inlinesUntil(notEnd1));
  const twoContents = many(attempt(inlinesUntil(notEnd2)));
  const oneContents = many(
    alt(
      inlinesUntil(notEnd1),
      attempt((ctx) => {
        const open = ctx.pos;
        if (pair(ctx) === FAIL || notEnd1(ctx) === FAIL) return FAIL;
        return two(ctx, [], open);
      }),
    ),
  );

  // Strong emphasis opened by `cc` at `open`, `prefix` read already.
  function two(ctx, prefix, open) {
    const xs = twoContents(ctx);
    if (xs === FAIL) return FAIL;
    const contents = B.join(prefix, B.concat(xs));
    if (end2(ctx) !== FAIL) {
      updateLastStrPos(ctx);
      return B.strong(contents, open, ctx.pos);
    }
    return B.join(B.str(c + c, open, open + 2), contents);
  }

  // Emphasis opened by `c` at `open`, `prefix` read already.
  function one(ctx, prefix, open) {
    const xs = oneContents(ctx);
    if (xs === FAIL) return FAIL;
    const contents = B.join(prefix, B.concat(xs));
    if (end1(ctx) !== FAIL) {
      updateLastStrPos(ctx);
      return B.emph(contents, open, ctx.pos);
    }
    return B.join(B.str(c, open, open + 1), contents);
  }

  // Strong emphasis around emphasis, opened by `ccc` at `open`: closed by
  // three, or by two then one, or one then two.
  function three(ctx, open) {
    const xs = threeContents(ctx);
    if (xs === FAIL) return FAIL;
    const contents = B.concat(xs);
    const closed = ctx.pos;
    if (end3(ctx) !== FAIL) {
      updateLastStrPos(ctx);
      const emph = B.emph(contents, open + 2, closed + 1);
      return B.strong(emph, open, ctx.pos);
    }
    if (end2(ctx) !== FAIL) {
      updateLastStrPos(ctx);
      return one(ctx, B.strong(contents, open + 1, ctx.pos), open);
    }
    if (end1(ctx) !== FAIL) {
      updateLastStrPos(ctx);
      return two(ctx, B.emph(contents, open + 2, ctx.pos), open);
    }
    return B.join(B.str(c.repeat(3), open, open + 3), contents);
  }

  return (ctx) => {
    // After a word, an underscore opens nothing, with `intraword_underscores`.
    const intraword =
      c === '_' &&
      enabled(ctx, 'intraword_underscores') &&
      !notAfterString(ctx);
    if (intraword) return FAIL;
    const open = ctx.pos;
    if (run(ctx) === FAIL) return FAIL;
    const cs = ctx.text.slice(open, ctx.pos);
    const space = whitespace(ctx);
    if (space !== FAIL) return B.join(B.str(cs, open, open + cs.length), space);
    if (cs.length === 3) return three(ctx, open);
    if (cs.length === 2) return two(ctx, [], open);
    if (cs.length === 1) return one(ctx, [], open);
    return B.str(cs, open, ctx.pos);
  };
}

/**
 * Emphasis or strong emphasis, delimited by `*` or `_`.
 *
 * @see Text.Pandoc.Readers.Markdown.strongOrEmph
 * @see Text.Pandoc.Readers.Markdown.enclosure
 */
export const strongOrEmph = alt(enclosure('*'), enclosure('_'));

/**
 * Inlines between `start` and `end`, no space just inside either.
 *
 * @see Text.Pandoc.Readers.Markdown.inlinesBetween
 * @param {import('../core.js').Parser<unknown>} start
 * @param {import('../core.js').Parser<unknown>} end
 * @returns {import('../core.js').Parser<Inlines>}
 */
function inlinesBetween(start, end) {
  const notEnd = notAhead(end);
  const notSpace = notAhead(whitespace);
  const inner = alt(
    attempt((ctx) => {
      const space = whitespace(ctx);
      return space === FAIL || notEnd(ctx) === FAIL ? FAIL : space;
    }),
    (ctx) => (notSpace(ctx) === FAIL ? FAIL : inline(ctx)),
  );
  const body = many1Till(inner, end);
  return attempt((ctx) => {
    if (start(ctx) === FAIL) return FAIL;
    const xs = body(ctx);
    return xs === FAIL ? FAIL : B.trimInlines(B.concat(xs));
  });
}

// Inlines between doubled `c`s, built by `build`, where `extension` is on.
function doubled(c, extension, build) {
  const opens = string(c + c);
  const nonspace = lookAhead(nonspaceChar);
  const noThird = notFollowedBy(char(c));
  const start = (ctx) =>
    opens(ctx) === FAIL || nonspace(ctx) === FAIL ? FAIL : noThird(ctx);
  const body = inlinesBetween(start, attempt(string(c + c)));
  return whenEnabled(extension, (ctx) => {
    const open = ctx.pos;
    const ils = body(ctx);
    return ils === FAIL ? FAIL : build(ils, open, ctx.pos);
  });
}

/**
 * Inlines between `~~`s, struck out.
 *
 * @see Text.Pandoc.Readers.Markdown.strikeout
 */
export const strikeout = doubled('~', 'strikeout', B.strikeout);

const MARK = Object.freeze(['', Object.freeze(['mark']), Object.freeze([])]);

/**
 * Inlines between `==`s, highlighted: a span of class `mark`.
 *
 * @see Text.Pandoc.Readers.Markdown.mark
 */
export const mark = doubled('=', 'mark', (ils, start, end) =>
  B.spanWith(MARK, ils, start, end),
);
