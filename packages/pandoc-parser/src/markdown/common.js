// Small parsers the markdown reader shares across its constructs.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`.

import { char, isAlphaNum, newline, noneOf, oneOf, satisfy } from '../char.js';
import { alt, attempt, FAIL, notFollowedBy, optional } from '../core.js';
import {
  blankline,
  characterReference,
  skipSpaces,
} from '../parsing/general.js';
import { whenEnabled } from '../parsing/state.js';

const noNewline = notFollowedBy(char('\n'));
const maybeNewline = optional(newline);

/**
 * Spaces, at most one line break among them, and no blank line after.
 *
 * @see Text.Pandoc.Readers.Markdown.spnl
 */
export const spnl = attempt((ctx) => {
  skipSpaces(ctx);
  if (maybeNewline(ctx) === FAIL) return FAIL;
  skipSpaces(ctx);
  return noNewline(ctx);
});

const backslash = char('\\');
const anySymbol = satisfy((c) => c !== '\n' && c !== '\r' && !isAlphaNum(c));
const extended = oneOf('\\`*_{}[]()>#+-.!~"<>');
const markdownSymbol = oneOf('\\`*_{}[]()>#+-.!');
const escapable = alt(
  whenEnabled('all_symbols_escapable', anySymbol),
  whenEnabled('angle_brackets_escapable', extended),
  markdownSymbol,
);

/**
 * A backslash and the character it escapes: with `all_symbols_escapable`,
 * any but a letter, digit or line break.
 *
 * @see Text.Pandoc.Readers.Markdown.escapedChar'
 * @type {import('../core.js').Parser<string>}
 */
export const escapedCharacter = attempt((ctx) =>
  backslash(ctx) === FAIL ? FAIL : escapable(ctx),
);

const noBlankLine = notFollowedBy(blankline);
const lineJoin = attempt((ctx) =>
  newline(ctx) === FAIL || noBlankLine(ctx) === FAIL ? FAIL : ' ',
);

/**
 * A character of literal text: an escaped one, a character reference, any
 * but a newline, or a newline before a non-blank line, as a space.
 *
 * @see Text.Pandoc.Readers.Markdown.litChar
 * @type {import('../core.js').Parser<string>}
 */
export const litChar = alt(
  escapedCharacter,
  characterReference,
  noneOf('\n'),
  lineJoin,
);
