// Notes: a reference `[^label]` to contents defined anywhere by
// `[^label]:` and an indented block, or contents written in place, `^[…]`.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `blocks.js`
// and `inlines.js` import this module, which imports them: what they
// import from here is a function declaration, and what this reads from
// them, it reads when called.

import * as B from '../ast/builder.js';
import { Node } from '../ast/nodes.js';
import { char } from '../char.js';
import { alt, attempt, FAIL, many, notFollowedBy, optional } from '../core.js';
import {
  anyLine,
  blankline,
  blanklines,
  notAhead,
  parseFromStringFresh,
} from '../parsing/general.js';
import {
  enabled,
  updateState,
  whenEnabled,
  withQuoteContext,
} from '../parsing/state.js';
import { SourceText } from '../source-text.js';
import { attributes } from './attributes.js';
import { parseBlocks } from './blocks.js';
import { indentSpaces, skipNonindentSpaces } from './common.js';
import { notFollowedByDivCloser } from './divs.js';
import { inBalancedBrackets, noteMarker } from './links.js';
import { lookupTables, pendingNote, withoutNotes } from './references.js';

/** @typedef {import('../core.js').Context} Context */

const countNote = (ctx) =>
  updateState(ctx, { noteNumber: ctx.state.noteNumber + 1 });

/**
 * A note's reference: its note where one is defined, filled once the read
 * ends, else the reference as written.
 *
 * @see Text.Pandoc.Readers.Markdown.note
 * @param {Context} ctx
 */
export function note(ctx) {
  return enabled(ctx, 'footnotes') ? noteAt(ctx) : FAIL;
}

const noteAt = attempt((ctx) => {
  const start = ctx.pos;
  const label = noteMarker(ctx);
  if (label === FAIL) return FAIL;
  countNote(ctx);
  if (!lookupTables(ctx).notes.has(label)) {
    return B.str(`[^${label}]`, start, ctx.pos);
  }
  const pending = pendingNote(label, ctx.state.noteNumber);
  return [new Node('Note', pending, start, ctx.pos)];
});

const caret = char('^');
const contentsInBrackets = withQuoteContext('NoQuote', inBalancedBrackets);
const noLinkAfter = notFollowedBy(
  alt(char('('), char('['), (ctx) => attributes(ctx)),
);

/**
 * `^`, then inlines in brackets: a note of one paragraph. Not before a
 * target, a reference or attributes, which make it a superscript's.
 *
 * @see Text.Pandoc.Readers.Markdown.inlineNote
 * @param {Context} ctx
 */
export function inlineNote(ctx) {
  return inlineNoteAt(ctx);
}

const inlineNoteAt = whenEnabled(
  'inline_notes',
  attempt((ctx) => {
    const start = ctx.pos;
    if (caret(ctx) === FAIL) return FAIL;
    updateState(ctx, { inNote: true, noteNumber: ctx.state.noteNumber + 1 });
    const from = ctx.pos + 1;
    const contents = contentsInBrackets(ctx);
    if (contents === FAIL || noLinkAfter(ctx) === FAIL) return FAIL;
    updateState(ctx, { inNote: false });
    const para = B.para(contents, from, ctx.pos - 1);
    return B.note(para, start, ctx.pos);
  }),
);

const noBlankline = notFollowedBy(blankline);
const noMarker = notAhead(
  attempt((ctx) =>
    skipNonindentSpaces(ctx) === FAIL ? FAIL : noteMarker(ctx),
  ),
);
const maybeIndent = optional(indentSpaces);

/**
 * A note's line after its first: not blank, no open div's closing fence,
 * no note's marker; a tab stop of indentation dropped. The line, its
 * newline kept.
 *
 * @see Text.Pandoc.Readers.Markdown.rawLine
 */
const rawLine = attempt((ctx) => {
  if (noBlankline(ctx) === FAIL || notFollowedByDivCloser(ctx) === FAIL) {
    return FAIL;
  }
  if (noMarker(ctx) === FAIL) return FAIL;
  maybeIndent(ctx);
  return lineRead(ctx);
});
const rawLineRest = many(rawLine);

// A line read, its newline kept, as extracted text.
function lineRead(ctx) {
  const from = ctx.pos;
  return anyLine(ctx) === FAIL
    ? FAIL
    : SourceText.slice(ctx.text, from, ctx.pos);
}

/**
 * A line, and the lines after it up to a blank line.
 *
 * @see Text.Pandoc.Readers.Markdown.rawLines
 * @returns {SourceText | typeof FAIL}
 */
function rawLines(ctx) {
  const first = lineRead(ctx);
  if (first === FAIL) return FAIL;
  const rest = rawLineRest(ctx);
  return rest === FAIL ? FAIL : SourceText.concat([first, ...rest]);
}

const colon = char(':');
const maybeBlankline = optional(blankline);
const maybeBlanklines = optional(blanklines);
const moreLines = many(
  attempt((ctx) =>
    blanklines(ctx) === FAIL || indentSpaces(ctx) === FAIL
      ? FAIL
      : rawLines(ctx),
  ),
);

// Each of `chunks`, a newline after it where the blank lines after it
// were: Haskell's `T.unlines`.
const unlined = (chunks) =>
  SourceText.concat(
    chunks.flatMap((chunk) => {
      const end = chunk.pieces.at(-1)?.to ?? 0;
      return [chunk, SourceText.synth('\n', end, end)];
    }),
  );

/**
 * A note's definition: its marker, `:`, then lines, more after blank lines
 * where indented, read again as blocks with no notes resolved. Recorded,
 * the last of a label's definitions its contents; no block.
 *
 * Not ported yet: the warning of a note defined again.
 *
 * @see Text.Pandoc.Readers.Markdown.noteBlock
 * @param {Context} ctx
 */
export function noteBlock(ctx) {
  return enabled(ctx, 'footnotes') ? noteBlockAt(ctx) : FAIL;
}

const noteBlockAt = attempt((ctx) => {
  if (skipNonindentSpaces(ctx) === FAIL) return FAIL;
  const label = noteMarker(ctx);
  if (label === FAIL || colon(ctx) === FAIL) return FAIL;
  maybeBlankline(ctx);
  maybeIndent(ctx);
  updateState(ctx, { inNote: true });
  const first = rawLines(ctx);
  if (first === FAIL) return FAIL;
  const rest = moreLines(ctx);
  if (rest === FAIL) return FAIL;
  const lines = unlined([first, ...rest]);
  const end = lines.pieces.at(-1)?.to ?? ctx.pos;
  const text = SourceText.concat([lines, SourceText.synth('\n', end, end)]);
  maybeBlanklines(ctx);
  const contents = withoutNotes(ctx, (c) =>
    parseFromStringFresh(c, parseBlocks, text),
  );
  if (contents === FAIL) return FAIL;
  updateState(ctx, {
    notes: ctx.state.notes.set(label, contents),
    inNote: false,
  });
  // A read of extracted text maps it out (parseFromString).
  ctx.notesDefined?.push([label, contents]);
  return [];
});
