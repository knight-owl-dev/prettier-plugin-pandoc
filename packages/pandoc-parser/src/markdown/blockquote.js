// Block quotes: lines marked by `>`, lazy lines among them, their text read
// again as blocks.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `blocks.js`
// imports this module and this one `blocks.js`: `blockQuote` is a function
// declaration and reads `parseBlocks` only when called, so either may load
// first.

import * as B from '../ast/builder.js';
import { char, newline } from '../char.js';
import { alt, attempt, eof, FAIL, notFollowedBy, optional } from '../core.js';
import {
  optionalBlanklines,
  parseFromStringFresh,
} from '../parsing/general.js';
import { SourceText } from '../source-text.js';
import { parseBlocks } from './blocks.js';
import { skipNonindentSpaces } from './common.js';
import { endline } from './inlines.js';

/** @typedef {import('../core.js').Context} Context */

const marker = char('>');
const markerSpace = optional(char(' '));

/**
 * A quote's marker: `>` after up to a tab stop less one of spaces, and a
 * space after it.
 *
 * @see Text.Pandoc.Readers.Markdown.emailBlockQuoteStart
 */
export const emailBlockQuoteStart = attempt((ctx) =>
  skipNonindentSpaces(ctx) === FAIL || marker(ctx) === FAIL
    ? FAIL
    : markerSpace(ctx),
);

const notQuoteStart = notFollowedBy(emailBlockQuoteStart);
const lazyBreak = attempt((ctx) =>
  endline(ctx) === FAIL ? FAIL : notQuoteStart(ctx),
);

// A quote's line, with the lazy lines after it: each joined by a newline
// standing for the line break and the spaces after it.
function emailLine(ctx) {
  const parts = [];
  let run = ctx.pos;
  for (;;) {
    const c = ctx.text[ctx.pos];
    if (c !== undefined && c !== '\n') {
      ctx.pos++;
      continue;
    }
    const at = ctx.pos;
    if (c === undefined || lazyBreak(ctx) === FAIL) break;
    parts.push(SourceText.slice(ctx.text, run, at));
    parts.push(SourceText.synth('\n', at, ctx.pos));
    run = ctx.pos;
  }
  parts.push(SourceText.slice(ctx.text, run, ctx.pos));
  return SourceText.concat(parts);
}

const separator = attempt((ctx) =>
  newline(ctx) === FAIL ? FAIL : emailBlockQuoteStart(ctx),
);
const lineEnd = alt(newline, eof);

/**
 * A quote's lines, markers stripped, joined by newlines that stand for the
 * line break and the next line's marker; where its last line ends.
 *
 * @see Text.Pandoc.Readers.Markdown.emailBlockQuote
 * @type {import('../core.js').Parser<{lines: SourceText, end: number}>}
 */
export const emailBlockQuote = attempt((ctx) => {
  if (emailBlockQuoteStart(ctx) === FAIL) return FAIL;
  const parts = [emailLine(ctx)];
  for (;;) {
    const at = ctx.pos;
    if (separator(ctx) === FAIL) break;
    parts.push(SourceText.synth('\n', at, ctx.pos), emailLine(ctx));
  }
  const end = ctx.pos;
  if (lineEnd(ctx) === FAIL || optionalBlanklines(ctx) === FAIL) return FAIL;
  return { lines: SourceText.concat(parts), end };
});

/**
 * A quote's lines read again as blocks.
 *
 * Not ported yet: GitHub's alerts, `alerts` off by default.
 *
 * @see Text.Pandoc.Readers.Markdown.blockQuote
 * @param {Context} ctx
 */
export function blockQuote(ctx) {
  const start = ctx.pos;
  const quote = emailBlockQuote(ctx);
  if (quote === FAIL) return FAIL;
  const text = SourceText.concat([
    quote.lines,
    SourceText.synth('\n\n', quote.end, quote.end),
  ]);
  const contents = parseFromStringFresh(ctx, parseBlocks, text);
  return contents === FAIL ? FAIL : B.blockQuote(contents, start, quote.end);
}
