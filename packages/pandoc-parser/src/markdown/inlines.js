// The markdown reader's inline parsers: each returns its inlines, every node
// spanning what it read.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. Its parsers
// return `F Inlines`, read once the whole document is; the port's return the
// inlines themselves. A parser not ported yet keeps its place as a comment.

import * as B from '../ast/builder.js';
import { alphaNum, char, newline, noneOf } from '../char.js';
import {
  alt,
  attempt,
  eof,
  FAIL,
  many,
  many1,
  notFollowedBy,
  option,
  skipMany1,
} from '../core.js';
import {
  blankline,
  many1Till,
  skipSpaces,
  spaceChar,
} from '../parsing/general.js';
import {
  apostrophe,
  dash,
  doubleCloseQuote,
  doubleQuoteEnd,
  doubleQuoteStart,
  ellipses,
  singleQuoteEnd,
  singleQuoteStart,
} from '../parsing/smart.js';
import {
  enabled,
  guardEnabled,
  updateLastStrPos,
  withQuoteContext,
} from '../parsing/state.js';

const manyInline = many((ctx) => inline(ctx));
const many1Inline = many1((ctx) => inline(ctx));

/**
 * Zero or more inlines, joined.
 *
 * @see Text.Pandoc.Readers.Markdown.inlines
 */
export const inlines = (ctx) => {
  const xs = manyInline(ctx);
  return xs === FAIL ? FAIL : B.concat(xs);
};

/**
 * One or more inlines, joined.
 *
 * @see Text.Pandoc.Readers.Markdown.inlines1
 */
export const inlines1 = (ctx) => {
  const xs = many1Inline(ctx);
  return xs === FAIL ? FAIL : B.concat(xs);
};

const noBlankLine = notFollowedBy(blankline);

/**
 * A line break that is only a space: no blank line, and no block that may
 * interrupt a paragraph, after it.
 *
 * Not ported yet, each needing a construct or a non-default extension: a
 * backtick fence; a list start in a list item, or anywhere with
 * `lists_without_preceding_blankline`; the closer of an open HTML block or
 * div. A block quote or ATX heading interrupts only with
 * `blank_before_blockquote` or `blank_before_header` off.
 *
 * @see Text.Pandoc.Readers.Markdown.endline
 */
export const endline = attempt((ctx) => {
  const start = ctx.pos;
  if (newline(ctx) === FAIL || noBlankLine(ctx) === FAIL) return FAIL;
  if (!ctx.state.allowLineBreaks) return FAIL;
  if (eof(ctx) !== FAIL) return [];
  if (enabled(ctx, 'hard_line_breaks')) return B.linebreak(start, ctx.pos);
  if (enabled(ctx, 'ignore_line_breaks')) return [];
  skipSpaces(ctx);
  return B.softbreak(start, ctx.pos);
});

const maybeEndline = option(null, endline);

/**
 * Spaces: a line break where two or more end a line, else a space.
 *
 * @see Text.Pandoc.Readers.Markdown.whitespace
 */
export function whitespace(ctx) {
  const start = ctx.pos;
  if (spaceChar(ctx) === FAIL) return FAIL;
  if (spaceChar(ctx) === FAIL) return B.space(start, ctx.pos);
  skipSpaces(ctx);
  const broken = maybeEndline(ctx);
  if (broken === FAIL) return FAIL;
  return (broken === null ? B.space : B.linebreak)(start, ctx.pos);
}

const dot = char('.');
const noDot = notFollowedBy(dot);
const loneDot = attempt((ctx) => (dot(ctx) === FAIL ? FAIL : noDot(ctx)));
const strParts = skipMany1(alt(skipMany1(alphaNum), loneDot));

// Not ported yet: neither a citation nor a note after the whitespace.
const maybeSpaceAfter = option(null, attempt(whitespace));

/**
 * A word: letters and digits, and dots one at a time. With `smart`, a space
 * after an abbreviation becomes a non-breaking space.
 *
 * @see Text.Pandoc.Readers.Markdown.str
 */
export function str(ctx) {
  const start = ctx.pos;
  if (strParts(ctx) === FAIL) return FAIL;
  const end = ctx.pos;
  const result = ctx.text.slice(start, end);
  updateLastStrPos(ctx);
  const word = B.str(result, start, end);
  if (!enabled(ctx, 'smart') || !ctx.state.options.abbreviations.has(result)) {
    return word;
  }
  const after = maybeSpaceAfter(ctx);
  if (after === FAIL) return FAIL;
  if (after === null) return word;
  const space = after.length === 1 && after[0].t === 'Space';
  return B.join(word, space ? B.str(' ', end, ctx.pos) : after);
}

// Not ported yet: a backslash only where no raw TeX block opens.
const symbolChar = alt(noneOf('<\\\n\t '), char('\\'));

/**
 * Any other character, as a word of its own.
 *
 * @see Text.Pandoc.Readers.Markdown.symbol
 */
export function symbol(ctx) {
  const start = ctx.pos;
  const c = symbolChar(ctx);
  return c === FAIL ? FAIL : B.str(c, start, ctx.pos);
}

// A span between quotes of `context`'s kind; where it never closes, the
// opening quote alone, as `alone`.
const quotedSpan = ({ opens, closes, context, build, alone }) => {
  const inlinesTill = many1Till(inline, closes);
  const body = attempt(
    withQuoteContext(context, (ctx) => {
      const xs = inlinesTill(ctx);
      return xs === FAIL ? FAIL : B.trimInlines(B.concat(xs));
    }),
  );
  return (ctx) => {
    const start = ctx.pos;
    if (opens(ctx) === FAIL) return FAIL;
    const ils = body(ctx);
    return ils === FAIL
      ? B.str(alone, start, ctx.pos)
      : build(ils, start, ctx.pos);
  };
};

/** @see Text.Pandoc.Readers.Markdown.singleQuoted */
export const singleQuoted = quotedSpan({
  opens: singleQuoteStart,
  closes: singleQuoteEnd,
  context: 'InSingleQuote',
  build: B.singleQuoted,
  alone: '’',
});

/** @see Text.Pandoc.Readers.Markdown.doubleQuoted */
export const doubleQuoted = quotedSpan({
  opens: doubleQuoteStart,
  closes: doubleQuoteEnd,
  context: 'InDoubleQuote',
  build: B.doubleQuoted,
  alone: '“',
});

const lessThan = char('<');

/**
 * A `<` that opens nothing, as a word of its own.
 *
 * Not ported yet: with `raw_html`, none where a block-level tag opens, or
 * the closer of an open HTML block.
 *
 * @see Text.Pandoc.Readers.Markdown.ltSign
 */
export function ltSign(ctx) {
  const start = ctx.pos;
  return lessThan(ctx) === FAIL ? FAIL : B.str('<', start, ctx.pos);
}

const smartOn = guardEnabled('smart');
const smartPunctuation = alt(
  doubleQuoted,
  singleQuoted,
  doubleCloseQuote,
  apostrophe,
  dash,
  ellipses,
);

/**
 * Smart punctuation, where `smart` is on.
 *
 * @see Text.Pandoc.Readers.Markdown.smart
 */
export const smart = (ctx) =>
  smartOn(ctx) === FAIL ? FAIL : smartPunctuation(ctx);

// `inline`'s dispatch: a parser by the character it starts with, then a
// word, then a symbol. Pandoc's choices not ported yet stay as comments.
const WORD_OR_SYMBOL = alt(/* bareURL, */ str, symbol);
const then = (p) => alt(p, WORD_OR_SYMBOL);
const BY_CHAR = new Map([
  [' ', then(whitespace)],
  ['\t', then(whitespace)],
  ['\n', then(endline)],
  // '`': code; '_', '*': strongOrEmph; '^': inlineNote, superscript;
  // '[': note, cite, bracketedSpan, wikilink, link; '!': image; '$': math;
  // '~': strikeout, subscript; '=': mark;
  // '\\': math, escapedNewline, escapedChar, rawLaTeXInline';
  // '@': cite, exampleRef; '&': charRef; ':': emoji.
  ['<', then(/* autoLink, spanHtml, rawHtmlInline, */ ltSign)],
  ['"', then(smart)],
  ["'", then(smart)],
  ['‘', then(smart)],
  ['\u0091', then(smart)],
  ['“', then(smart)],
  ['\u0093', then(smart)],
  ['-', then(/* cite, */ smart)],
  ['.', then(smart)],
]);

/**
 * One inline, chosen by the character it starts with, else a word or a
 * symbol.
 *
 * @see Text.Pandoc.Readers.Markdown.inline
 */
export function inline(ctx) {
  const c = ctx.text[ctx.pos];
  if (c === undefined) return FAIL;
  return (BY_CHAR.get(c) ?? WORD_OR_SYMBOL)(ctx);
}
