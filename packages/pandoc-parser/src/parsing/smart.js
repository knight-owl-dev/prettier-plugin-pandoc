// Smart punctuation: quotes, apostrophes, dashes and ellipses as the
// typographic characters they stand for. Each returns its inlines spanning
// what it read.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.Smart`; the quoted spans
// themselves are each reader's, `markdown/inlines.js` for markdown.

import * as B from '../ast/builder.js';
import { alphaNum, char, digit, satisfy, string } from '../char.js';
import { alt, attempt, FAIL, lookAhead, notFollowedBy } from '../core.js';
import { isSpaceChar } from './general.js';
import { enabled, failIfInQuoteContext, notAfterString } from './state.js';

const notSpaceAhead = lookAhead(satisfy((c) => !isSpaceChar(c)));
const notAlphaNumAhead = notFollowedBy(alphaNum);
const hyphen = char('-');
const twoHyphens = string('--');
const digitAhead = lookAhead(digit);

// A quote that opens: not inside the same kind, not right after a word, and
// not before a space.
const quoteStart = (quote, context) => {
  const outside = failIfInQuoteContext(context);
  const mark = char(quote);
  const opens = attempt((ctx) =>
    mark(ctx) === FAIL ? FAIL : notSpaceAhead(ctx),
  );
  return (ctx) =>
    outside(ctx) === FAIL || !notAfterString(ctx) ? FAIL : opens(ctx);
};

/** @see Text.Pandoc.Parsing.Smart.singleQuoteStart */
export const singleQuoteStart = quoteStart("'", 'InSingleQuote');

/** @see Text.Pandoc.Parsing.Smart.doubleQuoteStart */
export const doubleQuoteStart = quoteStart('"', 'InDoubleQuote');

const singleQuote = char("'");

/** @see Text.Pandoc.Parsing.Smart.singleQuoteEnd */
export const singleQuoteEnd = attempt((ctx) =>
  singleQuote(ctx) === FAIL ? FAIL : notAlphaNumAhead(ctx),
);

/** @see Text.Pandoc.Parsing.Smart.doubleQuoteEnd */
export const doubleQuoteEnd = char('"');

// The parser of `p`, then `str` of `value` spanning what `p` read.
const replacing = (p, value) => (ctx) => {
  const start = ctx.pos;
  return p(ctx) === FAIL ? FAIL : B.str(value, start, ctx.pos);
};

/**
 * An apostrophe, ASCII or typographic: a right single quotation mark.
 *
 * @see Text.Pandoc.Parsing.Smart.apostrophe
 */
export const apostrophe = replacing(alt(singleQuote, char('\u2019')), '\u2019');

/**
 * An ASCII quotation mark: a right double quotation mark.
 *
 * @see Text.Pandoc.Parsing.Smart.doubleCloseQuote
 */
export const doubleCloseQuote = replacing(doubleQuoteEnd, '\u201d');

/**
 * Three dots: a horizontal ellipsis.
 *
 * @see Text.Pandoc.Parsing.Smart.ellipses
 */
export const ellipses = replacing(attempt(string('...')), '\u2026');

/**
 * Two hyphens an en dash, three an em dash; with `old_dashes`, two an em
 * dash, and one before a digit an en dash.
 *
 * @see Text.Pandoc.Parsing.Smart.dash
 */
export const dash = attempt((ctx) => {
  const start = ctx.pos;
  const dashOf = (c) => B.str(c, start, ctx.pos);
  if (enabled(ctx, 'old_dashes')) {
    if (hyphen(ctx) === FAIL) return FAIL;
    if (hyphen(ctx) !== FAIL) return dashOf('\u2014');
    return digitAhead(ctx) === FAIL ? FAIL : dashOf('\u2013');
  }
  if (twoHyphens(ctx) === FAIL) return FAIL;
  return hyphen(ctx) === FAIL ? dashOf('\u2013') : dashOf('\u2014');
});
