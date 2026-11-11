// TeX math between delimiters: its text, as written but trimmed.
//
// Ported from Pandoc's `Text.Pandoc.Parsing.Math`. `latex_macros` is
// off (#74), so the reader's `applyMacros` keeps the text as it is.

import {
  anyChar,
  char,
  digit,
  newline,
  satisfy,
  space,
  string,
} from '../char.js';
import { alt, attempt, FAIL, many1, manyTill, notFollowedBy } from '../core.js';
import { trimMath } from '../shared.js';
import {
  blankline,
  isSpaceChar,
  many1Till,
  notAhead,
  spaceChar,
  textOf,
} from './general.js';
import { whenEnabled } from './state.js';

/** @template T @typedef {import('../core.js').Parser<T>} Parser */

const notDollar = notFollowedBy(char('$'));
const notBlankline = notAhead(blankline);

/**
 * Any character, a line feed only where no blank line follows it.
 *
 * @see Text.Pandoc.Parsing.Math.mathChar
 * @type {Parser<string>}
 */
const mathChar = alt(
  satisfy((c) => c !== '\n'),
  (ctx) => (newline(ctx) === FAIL || notBlankline(ctx) === FAIL ? FAIL : '\n'),
);

const commentLine = manyTill(anyChar, newline);

/**
 * A comment through its line feed, kept: its braces and dollars are text.
 *
 * @see Text.Pandoc.Parsing.Math.mathComment
 * @type {Parser<string>}
 */
function mathComment(ctx) {
  const from = ctx.pos;
  if (ctx.text[from] !== '%') return FAIL;
  ctx.pos++;
  if (commentLine(ctx) === FAIL || notBlankline(ctx) === FAIL) return FAIL;
  return ctx.text.slice(from, ctx.pos);
}

/**
 * A TeX group, whole, so a delimiter in a command's argument
 * (`\\text{a $x$}`) closes no math; an escaped brace nests nothing.
 *
 * @see Text.Pandoc.Parsing.Math.mathGroup
 * @type {Parser<string>}
 */
function mathGroup(ctx) {
  const from = ctx.pos;
  if (ctx.text[from] !== '{') return FAIL;
  ctx.pos++;
  let escaped = false;
  for (let depth = 1; depth > 0; ) {
    if (!escaped) {
      const at = ctx.pos;
      if (mathComment(ctx) !== FAIL) continue;
      if (ctx.pos !== at) return FAIL;
    }
    const c = mathChar(ctx);
    if (c === FAIL) return FAIL;
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (c === '}') depth--;
    else if (c === '{') depth++;
  }
  return ctx.text.slice(from, ctx.pos);
}

const plainChar = satisfy((c) => !isSpaceChar(c) && c !== '\\' && c !== '{');
const spaces = textOf(many1(spaceChar));
const escaped = (ctx) => {
  if (char('\\')(ctx) === FAIL) return FAIL;
  const c = anyChar(ctx);
  return c === FAIL ? FAIL : `\\${c}`;
};
const noSpaceAhead = notFollowedBy(space);
const noDigitAhead = notFollowedBy(digit);

/**
 * Math between `open` and `close`, over lines with no blank line between
 * them. With `$`: no space after the open, no space or line feed before a
 * `$`, no digit after the close, which would make it a price.
 *
 * @see Text.Pandoc.Parsing.Math.mathWith
 * @param {string} open
 * @param {string} close
 * @returns {Parser<string>}
 */
function mathWith(open, close) {
  const dollar = open === '$';
  // Before a `$` that may close inline math, no space or line feed.
  const beforeClose = (read) => (ctx) =>
    read === FAIL || (dollar && notDollar(ctx) === FAIL) ? FAIL : read;
  const chunk = alt(
    mathComment,
    mathGroup,
    plainChar,
    (ctx) => beforeClose(spaces(ctx))(ctx),
    (ctx) =>
      beforeClose(
        newline(ctx) === FAIL || notBlankline(ctx) === FAIL ? FAIL : '\n',
      )(ctx),
    escaped,
  );
  const opening = string(open);
  const words = many1Till(chunk, attempt(string(close)));
  return attempt((ctx) => {
    if (opening(ctx) === FAIL) return FAIL;
    if (dollar && noSpaceAhead(ctx) === FAIL) return FAIL;
    const read = words(ctx);
    if (read === FAIL || (close === '$' && noDigitAhead(ctx) === FAIL)) {
      return FAIL;
    }
    return trimMath(read.join(''));
  });
}

/**
 * Display math: `$$`, or the backslash delimiters their extensions enable.
 *
 * @see Text.Pandoc.Parsing.Math.mathDisplay
 * @type {Parser<string>}
 */
export const mathDisplay = alt(
  whenEnabled('tex_math_dollars', mathWith('$$', '$$')),
  whenEnabled('tex_math_single_backslash', mathWith('\\[', '\\]')),
  whenEnabled('tex_math_double_backslash', mathWith('\\\\[', '\\\\]')),
);

/**
 * Inline math: `$`, or the backslash delimiters their extensions enable.
 *
 * @see Text.Pandoc.Parsing.Math.mathInline
 * @type {Parser<string>}
 */
export const mathInline = alt(
  whenEnabled('tex_math_dollars', mathWith('$', '$')),
  whenEnabled('tex_math_single_backslash', mathWith('\\(', '\\)')),
  whenEnabled('tex_math_double_backslash', mathWith('\\\\(', '\\\\)')),
);
