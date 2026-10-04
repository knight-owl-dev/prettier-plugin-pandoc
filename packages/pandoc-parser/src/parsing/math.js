// TeX math between delimiters: its text, as written but trimmed.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.Math`. `latex_macros` is
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
import { alt, attempt, FAIL, many1, notFollowedBy } from '../core.js';
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

const backslash = char('\\');
const notDollar = notFollowedBy(char('$'));
const notBlankline = notAhead(blankline);

/**
 * Braces and what they hold, balanced, a backslash escaping the character
 * after it: what `\text` takes, which may hold a math delimiter.
 *
 * @see Text.Pandoc.Parsing.Math.mathInlineWith
 * @type {Parser<string>}
 */
function inBalancedBraces(ctx) {
  const { text } = ctx;
  if (text[ctx.pos] !== '{') return FAIL;
  const from = ctx.pos;
  let depth = 0;
  for (let at = from; at < text.length; ) {
    const c = String.fromCodePoint(text.codePointAt(at));
    at += c.length;
    if (c === '\\') {
      if (at >= text.length) break;
      at += String.fromCodePoint(text.codePointAt(at)).length;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      ctx.pos = at;
      return text.slice(from, at);
    }
  }
  ctx.pos = text.length;
  return FAIL;
}

const text = string('text');
const textCommand = attempt((ctx) => {
  if (text(ctx) === FAIL) return FAIL;
  const braces = inBalancedBraces(ctx);
  return braces === FAIL ? FAIL : `\\text${braces}`;
});
const mathChar = satisfy((c) => !isSpaceChar(c) && c !== '\\');
const escaped = (ctx) => {
  if (backslash(ctx) === FAIL) return FAIL;
  const command = textCommand(ctx);
  if (command !== FAIL) return command;
  const c = anyChar(ctx);
  return c === FAIL ? FAIL : `\\${c}`;
};
const lineBreak = (ctx) =>
  blankline(ctx) === FAIL ||
  notBlankline(ctx) === FAIL ||
  notDollar(ctx) === FAIL
    ? FAIL
    : '\n';
const spaces = (ctx) => {
  const s = textOf(many1(spaceChar))(ctx);
  return s === FAIL || notDollar(ctx) === FAIL ? FAIL : s;
};
const inlineChunk = alt(mathChar, escaped, lineBreak, spaces);
const noSpaceAhead = notFollowedBy(space);
const noDigitAhead = notFollowedBy(digit);

/**
 * Math between `open` and `close` on a line, or lines with no blank line
 * between them: after `$`, no space; after the close, no digit, which
 * would make it a price.
 *
 * @see Text.Pandoc.Parsing.Math.mathInlineWith
 * @param {string} open
 * @param {string} close
 * @returns {Parser<string>}
 */
function mathInlineWith(open, close) {
  const opening = string(open);
  const words = many1Till(inlineChunk, attempt(string(close)));
  return attempt((ctx) => {
    if (opening(ctx) === FAIL) return FAIL;
    if (open === '$' && noSpaceAhead(ctx) === FAIL) return FAIL;
    const read = words(ctx);
    if (read === FAIL || noDigitAhead(ctx) === FAIL) return FAIL;
    return trimMath(read.join(''));
  });
}

const displayChar = alt(
  satisfy((c) => c !== '\n'),
  (ctx) => (newline(ctx) === FAIL || notBlankline(ctx) === FAIL ? FAIL : '\n'),
);

/**
 * Math between `open` and `close`, over lines with no blank line between
 * them.
 *
 * @see Text.Pandoc.Parsing.Math.mathDisplayWith
 * @param {string} open
 * @param {string} close
 * @returns {Parser<string>}
 */
function mathDisplayWith(open, close) {
  const opening = string(open);
  const chars = many1Till(displayChar, attempt(string(close)));
  return attempt((ctx) => {
    if (opening(ctx) === FAIL) return FAIL;
    const read = chars(ctx);
    return read === FAIL ? FAIL : read.join('');
  });
}

/**
 * Display math: `$$`, or the backslash delimiters their extensions enable.
 *
 * @see Text.Pandoc.Parsing.Math.mathDisplay
 * @type {Parser<string>}
 */
export const mathDisplay = alt(
  whenEnabled('tex_math_dollars', mathDisplayWith('$$', '$$')),
  whenEnabled('tex_math_single_backslash', mathDisplayWith('\\[', '\\]')),
  whenEnabled('tex_math_double_backslash', mathDisplayWith('\\\\[', '\\\\]')),
);

/**
 * Inline math: `$`, or the backslash delimiters their extensions enable.
 *
 * @see Text.Pandoc.Parsing.Math.mathInline
 * @type {Parser<string>}
 */
export const mathInline = alt(
  whenEnabled('tex_math_dollars', mathInlineWith('$', '$')),
  whenEnabled('tex_math_single_backslash', mathInlineWith('\\(', '\\)')),
  whenEnabled('tex_math_double_backslash', mathInlineWith('\\\\(', '\\\\)')),
);
