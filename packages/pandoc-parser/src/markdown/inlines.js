// The markdown reader's inline parsers: each returns its inlines, every node
// spanning what it read.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. Its parsers
// return `F Inlines`, read once the whole document is; the port's return the
// inlines themselves. A parser not ported yet keeps its place as a comment.

import * as B from '../ast/builder.js';
import { nullAttr } from '../ast/nodes.js';
import {
  alphaNum,
  char,
  isSpace,
  newline,
  noneOf,
  satisfy,
  string,
} from '../char.js';
import {
  alt,
  attempt,
  eof,
  FAIL,
  lookAhead,
  many,
  many1,
  manyTill,
  notFollowedBy,
  option,
  skipMany1,
} from '../core.js';
import {
  blankline,
  charRef,
  many1Till,
  notAhead,
  skipSpaces,
  spaceChar,
  textOf,
} from '../parsing/general.js';
import { mathDisplay, mathInline } from '../parsing/math.js';
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
  updateLastStrPos,
  whenEnabled,
  withQuoteContext,
} from '../parsing/state.js';
import { NBSP, trim } from '../shared.js';
import { attributes, rawAttribute } from './attributes.js';
import { codeBlockFenced } from './code.js';
import { escapedCharacter, unescaped } from './common.js';
import { notFollowedByDivCloser } from './divs.js';
import { mark, strikeout, strongOrEmph } from './emphasis.js';
import { bracketedSpan, image, link } from './links.js';
import { listStart, listStartInItem } from './lists.js';
import { inlineNote, note } from './notes.js';
import { subscript, superscript } from './scripts.js';

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
const noListItemStart = notFollowedBy(listStartInItem);
const noListStart = notFollowedBy(listStart);
const backtickFence = whenEnabled(
  'backtick_code_blocks',
  lookAhead((ctx) => (ctx.text[ctx.pos] === '`' ? codeBlockFenced(ctx) : FAIL)),
);

/**
 * A line break that is only a space: no blank line, and no block that may
 * interrupt a paragraph, after it.
 *
 * A list start interrupts in a list item, or anywhere with
 * `lists_without_preceding_blankline`; so do a backtick fence and an open
 * div's closing fence. Not ported yet: an open HTML block's closer. A block
 * quote or ATX
 * heading interrupts only with `blank_before_blockquote` or
 * `blank_before_header` off.
 *
 * @see Text.Pandoc.Readers.Markdown.endline
 */
export const endline = attempt((ctx) => {
  const start = ctx.pos;
  if (newline(ctx) === FAIL || noBlankLine(ctx) === FAIL) return FAIL;
  if (!ctx.state.allowLineBreaks || noListItemStart(ctx) === FAIL) return FAIL;
  if (enabled(ctx, 'lists_without_preceding_blankline')) {
    if (noListStart(ctx) === FAIL) return FAIL;
  }
  if (backtickFence(ctx) !== FAIL) return FAIL;
  if (notFollowedByDivCloser(ctx) === FAIL) return FAIL;
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

// Not ported yet: no citation after the whitespace either.
const noNoteAhead = notFollowedBy(note);
const maybeSpaceAfter = option(
  null,
  attempt((ctx) => {
    const space = whitespace(ctx);
    return space === FAIL || noNoteAhead(ctx) === FAIL ? FAIL : space;
  }),
);

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
  return B.join(word, space ? B.str(NBSP, end, ctx.pos) : after);
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

/**
 * Smart punctuation, where `smart` is on.
 *
 * @see Text.Pandoc.Readers.Markdown.smart
 */
export const smart = whenEnabled(
  'smart',
  alt(doubleQuoted, singleQuoted, doubleCloseQuote, apostrophe, dash, ellipses),
);

const displayMath = (ctx) => {
  const start = ctx.pos;
  const t = mathDisplay(ctx);
  return t === FAIL ? FAIL : B.displayMath(t, start, ctx.pos);
};
const inlineMath = (ctx) => {
  const start = ctx.pos;
  const t = mathInline(ctx);
  return t === FAIL ? FAIL : B.math(t, start, ctx.pos);
};
const noSpaceOrPunctuation = notFollowedBy(
  satisfy((c) => isSpace(c) || /^\p{P}$/u.test(c)),
);
const apostropheAfter = option(
  [],
  attempt(
    whenEnabled('smart', (ctx) => {
      const a = apostrophe(ctx);
      return a === FAIL || noSpaceOrPunctuation(ctx) === FAIL ? FAIL : a;
    }),
  ),
);

/**
 * TeX math, display or inline; with `smart`, an apostrophe right after
 * inline math, a word's.
 *
 * @see Text.Pandoc.Readers.Markdown.math
 */
export const math = alt(displayMath, (ctx) => {
  const m = inlineMath(ctx);
  if (m === FAIL) return FAIL;
  const a = apostropheAfter(ctx);
  return a === FAIL ? FAIL : B.concat([m, a]);
});

const backtick = char('`');
const backticks = skipMany1(backtick);
const noBlank = notAhead(blankline);
const codeText = alt(
  textOf(skipMany1(noneOf('`\n'))),
  textOf(backticks),
  (ctx) =>
    newline(ctx) === FAIL ||
    noListItemStart(ctx) === FAIL ||
    noBlank(ctx) === FAIL
      ? FAIL
      : ' ',
);
const noBacktick = notFollowedBy(backtick);

// The body of a code span opened by `n` backticks, through the `n` that
// close it: one parser for each `n`.
const codeBodies = new Map();
function codeBody(n) {
  let body = codeBodies.get(n);
  if (body === undefined) {
    const run = string('`'.repeat(n));
    const closes = attempt((ctx) => {
      skipSpaces(ctx);
      return run(ctx) === FAIL ? FAIL : noBacktick(ctx);
    });
    body = manyTill(codeText, closes);
    codeBodies.set(n, body);
  }
  return body;
}

const rawAttr = whenEnabled('raw_attribute', attempt(rawAttribute));
const codeAttributes = option(
  nullAttr,
  whenEnabled('inline_code_attributes', attributes),
);

/**
 * A code span: the text between runs of the same number of backticks,
 * trimmed, a line break in it a space; with attributes after it, or as raw
 * inline content with a raw attribute.
 *
 * @see Text.Pandoc.Readers.Markdown.code
 */
export const code = attempt((ctx) => {
  const start = ctx.pos;
  if (backticks(ctx) === FAIL) return FAIL;
  const n = ctx.pos - start;
  skipSpaces(ctx);
  const parts = codeBody(n)(ctx);
  if (parts === FAIL) return FAIL;
  const result = trim(parts.join(''));
  const format = rawAttr(ctx);
  if (format !== FAIL) return B.rawInline(format, result, start, ctx.pos);
  const attr = codeAttributes(ctx);
  return attr === FAIL ? FAIL : B.codeWith(attr, result, start, ctx.pos);
});

const backslash = char('\\');
const newlineAhead = lookAhead(newline);

/**
 * A backslash ending a line: a line break, the newline left to read.
 *
 * @see Text.Pandoc.Readers.Markdown.escapedNewline
 */
export const escapedNewline = whenEnabled(
  'escaped_line_breaks',
  attempt((ctx) => {
    const start = ctx.pos;
    if (backslash(ctx) === FAIL || newlineAhead(ctx) === FAIL) return FAIL;
    return B.linebreak(start, ctx.pos);
  }),
);

/**
 * An escaped character, as itself; an escaped space, a non-breaking one.
 *
 * @see Text.Pandoc.Readers.Markdown.escapedChar
 */
export function escapedChar(ctx) {
  const start = ctx.pos;
  const c = escapedCharacter(ctx);
  if (c === FAIL) return FAIL;
  return B.str(unescaped(c), start, ctx.pos);
}

// `inline`'s dispatch: a parser by the character it starts with, then a
// word, then a symbol. Pandoc's choices not ported yet stay as comments.
// The parsers of `emphasis.js` and `scripts.js` are read when called: each
// imports this module, so whichever loads first, they may not exist yet here.
const WORD_OR_SYMBOL = alt(/* bareURL, */ str, symbol);
const then = (p) => alt(p, WORD_OR_SYMBOL);
const BY_CHAR = new Map([
  [' ', then(whitespace)],
  ['\t', then(whitespace)],
  ['\n', then(endline)],
  ['`', then(code)],
  ['_', then((ctx) => strongOrEmph(ctx))],
  ['*', then((ctx) => strongOrEmph(ctx))],
  ['^', then(alt(inlineNote, (ctx) => superscript(ctx)))],
  // '[': cite and wikilink not ported yet.
  ['[', then(alt(note, bracketedSpan, link))],
  ['!', then(image)],
  ['$', then((ctx) => math(ctx))],
  [
    '~',
    then(
      alt(
        (ctx) => strikeout(ctx),
        (ctx) => subscript(ctx),
      ),
    ),
  ],
  ['=', then((ctx) => mark(ctx))],
  [
    '\\',
    then(
      alt(
        (ctx) => math(ctx),
        escapedNewline,
        escapedChar /* , rawLaTeXInline' */,
      ),
    ),
  ],
  // '@': cite, exampleRef; ':': emoji.
  ['&', then(charRef)],
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
