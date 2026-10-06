// Headings: ATX (`# Title`) and setext (a title underlined by `=` or `-`),
// with attributes, identifiers, and implicit reference keys.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`.

import * as B from '../ast/builder.js';
import { nullAttr } from '../ast/nodes.js';
import { char, oneOf } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  notFollowedBy,
  option,
  skipMany,
  skipMany1,
} from '../core.js';
import { unlogged } from '../logging.js';
import {
  anyLine,
  blankline,
  blanklines,
  isSpaceChar,
  lineEnd,
  registerHeader,
  skipSpaces,
} from '../parsing/general.js';
import { enabled, toKey, updateState, whenEnabled } from '../parsing/state.js';
import { attributes } from './attributes.js';
import { inline } from './inlines.js';
import { lookupCount, withoutTables } from './references.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../parsing/state.js').Attr} Attr */

const maybeAttributes = option(
  nullAttr,
  whenEnabled('header_attributes', attributes),
);

// The inlines of a heading's text, read with line breaks off, until
// `ends`: trimmed.
function readHeadingText(ctx, ends) {
  const outer = ctx.state.allowLineBreaks;
  updateState(ctx, { allowLineBreaks: false });
  const xs = ends(ctx);
  if (xs === FAIL) return FAIL;
  updateState(ctx, { allowLineBreaks: outer });
  return B.trimInlines(B.concat(xs));
}

/**
 * A heading's text: its inlines, the text read, and the inlines its
 * identifier is made from, which Pandoc reads with no reference resolved
 * (`runF text defaultParserState`).
 *
 * @param {Context} ctx
 * @param {import('../core.js').Parser<unknown>} ends
 */
function headingText(ctx, ends) {
  const start = ctx.pos;
  const lookups = lookupCount(ctx);
  const ils = readHeadingText(ctx, ends);
  if (ils === FAIL) return FAIL;
  const raw = ctx.text.slice(start, ctx.pos);
  if (lookupCount(ctx) === lookups) return { ils, raw, unresolved: ils };
  const { pos, state } = ctx;
  ctx.pos = start;
  const unresolved = unlogged(ctx, () =>
    withoutTables(ctx, (c) => readHeadingText(c, ends)),
  );
  [ctx.pos, ctx.state] = [pos, state];
  return { ils, raw, unresolved };
}

// `inline`s while `closing` does not follow.
const inlinesBefore = (closing) => {
  const notClosing = notFollowedBy(closing);
  return many((ctx) => (notClosing(ctx) === FAIL ? FAIL : inline(ctx)));
};

/**
 * Record a heading's text as a reference key to it, unless one is already.
 *
 * @see Text.Pandoc.Readers.Markdown.registerImplicitHeader
 * @param {Context} ctx
 * @param {string} raw
 * @param {Attr} attr
 */
function registerImplicitHeader(ctx, raw, attr) {
  if (raw === '' || !enabled(ctx, 'implicit_header_references')) return;
  const key = toKey(`[${raw}]`);
  const keys = ctx.state.headerKeys;
  if (keys.has(key)) return;
  const target = [`#${attr[0]}`, ''];
  updateState(ctx, { headerKeys: keys.set(key, [target, attr]) });
}

// A heading of `level` and its text: attributes and identifier settled.
function heading(ctx, attr, level, { ils, raw, unresolved }, start, end) {
  const settled = registerHeader(ctx, attr, unresolved, [start, end]);
  registerImplicitHeader(ctx, raw, settled);
  return B.headerWith(settled, level, ils, start, end);
}

// The character an ATX heading's marks are made of: `=` under
// `literate_haskell`, else `#`.
const atxChar = (ctx) => (enabled(ctx, 'literate_haskell') ? '=' : '#');

const hashes = skipMany(char('#'));
const equalSigns = skipMany(char('='));

/**
 * What ends an ATX heading's line: closing marks, spaces, attributes and
 * blank lines. The attributes, and where the line's text ends.
 *
 * Not ported yet: `mmd_header_identifiers`, off by default.
 *
 * @see Text.Pandoc.Readers.Markdown.atxClosing
 * @type {import('../core.js').Parser<[Attr, number]>}
 */
const atxClosing = attempt((ctx) => {
  (atxChar(ctx) === '#' ? hashes : equalSigns)(ctx);
  skipSpaces(ctx);
  const attr = maybeAttributes(ctx);
  if (attr === FAIL) return FAIL;
  const end = lineEnd(ctx.text, ctx.pos);
  return blanklines(ctx) === FAIL ? FAIL : [attr, end];
});

const atxText = inlinesBefore(atxClosing);
const listDelimiterAhead = lookAhead(oneOf('.)'));

/**
 * `#` to `######` and more, then the heading's text.
 *
 * @see Text.Pandoc.Readers.Markdown.atxHeader
 */
export const atxHeader = attempt((ctx) => {
  const start = ctx.pos;
  const mark = atxChar(ctx);
  while (ctx.text[ctx.pos] === mark) ctx.pos++;
  const level = ctx.pos - start;
  if (level === 0) return FAIL;
  // `#.` or `#)` opens a fancy list instead.
  if (enabled(ctx, 'fancy_lists') && listDelimiterAhead(ctx) !== FAIL) {
    return FAIL;
  }
  const next = ctx.text[ctx.pos];
  if (enabled(ctx, 'space_in_atx_header') && next !== undefined) {
    if (!isSpaceChar(next)) return FAIL;
  }
  skipSpaces(ctx);
  const text = headingText(ctx, atxText);
  if (text === FAIL) return FAIL;
  const closing = atxClosing(ctx);
  if (closing === FAIL) return FAIL;
  const [attr, end] = closing;
  return heading(ctx, attr, level, text, start, end);
});

/**
 * Attributes and blank lines after a setext heading's text: the attributes.
 *
 * Not ported yet: `mmd_header_identifiers`, off by default.
 *
 * @see Text.Pandoc.Readers.Markdown.setextHeaderEnd
 */
const setextHeaderEnd = attempt((ctx) => {
  const attr = maybeAttributes(ctx);
  return attr === FAIL || blanklines(ctx) === FAIL ? FAIL : attr;
});

const setextText = inlinesBefore(setextHeaderEnd);
const UNDERLINES = '=-';
const underlineChars = skipMany1(oneOf(UNDERLINES));
const underlined = lookAhead(
  attempt((ctx) =>
    anyLine(ctx) === FAIL || underlineChars(ctx) === FAIL
      ? FAIL
      : blankline(ctx),
  ),
);

/**
 * A line of text, then a line of `=` (level 1) or `-` (level 2).
 *
 * @see Text.Pandoc.Readers.Markdown.setextHeader
 */
export const setextHeader = attempt((ctx) => {
  const start = ctx.pos;
  if (underlined(ctx) === FAIL) return FAIL;
  skipSpaces(ctx);
  const text = headingText(ctx, setextText);
  if (text === FAIL) return FAIL;
  const attr = setextHeaderEnd(ctx);
  if (attr === FAIL) return FAIL;
  const underline = ctx.text[ctx.pos];
  if (!UNDERLINES.includes(underline)) return FAIL;
  while (ctx.text[ctx.pos] === underline) ctx.pos++;
  const end = lineEnd(ctx.text, ctx.pos);
  if (blanklines(ctx) === FAIL) return FAIL;
  return heading(
    ctx,
    attr,
    UNDERLINES.indexOf(underline) + 1,
    text,
    start,
    end,
  );
});

/**
 * A setext heading, else an ATX one.
 *
 * @see Text.Pandoc.Readers.Markdown.header
 */
export const header = alt(setextHeader, atxHeader);
