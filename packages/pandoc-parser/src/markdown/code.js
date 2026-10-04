// Code blocks: fenced, and indented by a tab stop.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`.

import * as B from '../ast/builder.js';
import { isSpace, satisfy } from '../char.js';
import { alt, attempt, FAIL, many1, option } from '../core.js';
import {
  anyLine,
  anyLineNewline,
  blankline,
  blanklines,
  gobbleAtMostSpaces,
  lineEnd,
  optionalBlanklines,
  skipSpaces,
  textOf,
} from '../parsing/general.js';
import { enabled, whenEnabled } from '../parsing/state.js';
import { stripTrailingNewlines, toLower } from '../shared.js';
import { attributes, rawAttribute } from './attributes.js';
import { indentSpaces, skipNonindentSpaces } from './common.js';

/** @typedef {import('../core.js').Context} Context */

/**
 * A fence of the character `c`, after up to a tab stop less one of spaces:
 * at least `length` of it, or 3 where `length` is null. Its length, or
 * `FAIL` with nothing read.
 *
 * @see Text.Pandoc.Readers.Markdown.blockDelimiter
 * @param {Context} ctx
 * @param {string} c
 * @param {number | null} length
 * @returns {number | typeof FAIL}
 */
function blockDelimiter(ctx, c, length) {
  const start = ctx.pos;
  if (skipNonindentSpaces(ctx) !== FAIL) {
    const from = ctx.pos;
    while (ctx.text[ctx.pos] === c) ctx.pos++;
    const run = ctx.pos - from;
    if (run >= (length ?? 3)) return length ?? run;
  }
  ctx.pos = start;
  return FAIL;
}

// GitHub's names for a language, as Pandoc maps them.
const LANGUAGES = new Map([
  ['c++', 'cpp'],
  ['objective-c', 'objectivec'],
]);

/**
 * A language name as Pandoc keeps it: GitHub's spelling, lowercased.
 *
 * @see Text.Pandoc.Readers.Markdown.toLanguageId
 * @param {string} name
 */
const toLanguageId = (name) => toLower(LANGUAGES.get(name) ?? name);

const languageId = option(
  null,
  textOf(
    many1(satisfy((c) => c !== '`' && c !== '{' && c !== '}' && !isSpace(c))),
  ),
);
const rawFormat = whenEnabled('raw_attribute', attempt(rawAttribute));
const fencedAttributes = option(
  null,
  whenEnabled('fenced_code_attributes', attributes),
);

// The attributes after an opening fence: a language, then attributes, the
// language's class first among theirs.
function fenceAttributes(ctx) {
  const name = languageId(ctx);
  const classes = name === null ? [] : [toLanguageId(name)];
  skipSpaces(ctx);
  const attr = fencedAttributes(ctx);
  if (attr === FAIL) return FAIL;
  if (attr === null) return ['', classes, []];
  const [id, theirs, pairs] = attr;
  return [id, [...classes, ...theirs], pairs];
}

// Where a closing fence of at least `size` of `c` ends, blank lines read
// after it; `FAIL` with nothing read.
function closingFence(ctx, c, size) {
  const start = ctx.pos;
  if (blockDelimiter(ctx, c, size) !== FAIL) {
    const end = lineEnd(ctx.text, ctx.pos);
    if (blanklines(ctx) !== FAIL) return end;
  }
  ctx.pos = start;
  return FAIL;
}

/**
 * Lines between fences of three or more backticks or tildes, the closing
 * one at least as long; with a language, attributes, or a raw attribute.
 * A fence never closed opens nothing.
 *
 * @see Text.Pandoc.Readers.Markdown.codeBlockFenced
 */
export const codeBlockFenced = attempt((ctx) => {
  const start = ctx.pos;
  const indent = skipNonindentSpaces(ctx);
  if (indent === FAIL) return FAIL;
  const c = ctx.text[ctx.pos];
  const fenced =
    (c === '~' && enabled(ctx, 'fenced_code_blocks')) ||
    (c === '`' && enabled(ctx, 'backtick_code_blocks'));
  if (!fenced) return FAIL;
  const size = blockDelimiter(ctx, c, null);
  if (size === FAIL) return FAIL;
  skipSpaces(ctx);
  const format = rawFormat(ctx);
  const attr = format === FAIL ? fenceAttributes(ctx) : null;
  if (attr === FAIL || blankline(ctx) === FAIL) return FAIL;
  // `manyTill`, keeping where the closing fence ends.
  const lines = [];
  for (;;) {
    const end = closingFence(ctx, c, size);
    if (end !== FAIL) {
      const contents = lines.join('\n');
      return format === FAIL
        ? B.codeBlockWith(attr, contents, start, end)
        : B.rawBlock(format, contents, start, end);
    }
    gobbleAtMostSpaces(ctx, indent);
    const line = anyLine(ctx);
    if (line === FAIL) return FAIL;
    lines.push(line);
  }
});

const indentedLine = (ctx) =>
  indentSpaces(ctx) === FAIL ? FAIL : anyLineNewline(ctx);
const indentedChunks = many1(
  alt(
    indentedLine,
    attempt((ctx) => {
      const blank = blanklines(ctx);
      if (blank === FAIL) return FAIL;
      const line = indentedLine(ctx);
      return line === FAIL ? FAIL : '\n'.repeat(blank.length) + line;
    }),
  ),
);

/**
 * Lines indented by a tab stop, blank lines among them kept.
 *
 * @see Text.Pandoc.Readers.Markdown.codeBlockIndented
 */
export function codeBlockIndented(ctx) {
  const start = ctx.pos;
  const chunks = indentedChunks(ctx);
  if (chunks === FAIL) return FAIL;
  // Before the last line's newline.
  const end = ctx.pos - 1;
  if (optionalBlanklines(ctx) === FAIL) return FAIL;
  const contents = stripTrailingNewlines(chunks.join(''));
  // Classes from `readerIndentedCodeClasses`: none by default.
  return B.codeBlockWith(['', [], []], contents, start, end);
}
