// General parsers of Pandoc's toolkit, as its readers compose them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.General`.

import * as B from '../ast/builder.js';
import { mapSpans, withContents } from '../ast/spans.js';
import { char, newline, satisfy, space } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  many,
  many1,
  manyTill,
  notFollowedBy,
  optional,
  skipMany,
} from '../core.js';
import { lookupEntity } from '../entities.js';
import { logMessage, logOf, message } from '../logging.js';
import { NBSP, uniqueIdent } from '../shared.js';
import { SourceText } from '../source-text.js';
import { enabled, updateState } from './state.js';

/** @typedef {import('../core.js').Context} Context */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */

/**
 * A space, tab, line feed or carriage return.
 *
 * @see Text.Pandoc.Parsing.General.isSpaceChar
 * @param {string} c
 */
export const isSpaceChar = (c) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * Any character but a space, tab, line feed or carriage return.
 *
 * @see Text.Pandoc.Parsing.General.nonspaceChar
 */
export const nonspaceChar = satisfy((c) => !isSpaceChar(c));

/**
 * A space or a tab.
 *
 * @see Text.Pandoc.Parsing.General.spaceChar
 */
export const spaceChar = satisfy((c) => c === ' ' || c === '\t');

/**
 * Zero or more spaces or tabs.
 *
 * @see Text.Pandoc.Parsing.General.skipSpaces
 */
export const skipSpaces = skipMany(spaceChar);

/**
 * Spaces or tabs, then a newline.
 *
 * @see Text.Pandoc.Parsing.General.blankline
 */
export const blankline = attempt((ctx) =>
  skipSpaces(ctx) === FAIL ? FAIL : newline(ctx),
);

/**
 * One or more blank lines.
 *
 * @see Text.Pandoc.Parsing.General.blanklines
 */
export const blanklines = many1(blankline);

/** Blank lines, or none: Haskell's `optional blanklines`. */
export const optionalBlanklines = optional(blanklines);

/**
 * Succeed where `p` fails, reading nothing. Unlike Parsec's `notFollowedBy`,
 * a `p` that succeeds without consuming fails it too.
 *
 * @see Text.Pandoc.Parsing.General.notFollowedBy'
 * @param {Parser<unknown>} p
 * @returns {Parser<undefined>}
 */
export function notAhead(p) {
  return (ctx) => {
    const { pos, state } = ctx;
    const x = p(ctx);
    ctx.pos = pos;
    ctx.state = state;
    return x === FAIL ? undefined : FAIL;
  };
}

/**
 * One or more of `p` until `end`, which may not succeed first.
 *
 * @see Text.Pandoc.Parsing.General.many1Till
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} end
 * @returns {Parser<T[]>}
 */
export function many1Till(p, end) {
  const notEnd = notAhead(end);
  const rest = manyTill(p, end);
  return (ctx) => {
    if (notEnd(ctx) === FAIL) return FAIL;
    const first = p(ctx);
    if (first === FAIL) return FAIL;
    const xs = rest(ctx);
    return xs === FAIL ? FAIL : [first, ...xs];
  };
}

/**
 * One or more of `p` between `start` and `end`, `start` not followed by a
 * space.
 *
 * @see Text.Pandoc.Parsing.General.enclosed
 * @template T
 * @param {Parser<unknown>} start
 * @param {Parser<unknown>} end
 * @param {Parser<T>} p
 * @returns {Parser<T[]>}
 */
export function enclosed(start, end, p) {
  const noSpace = notFollowedBy(space);
  const body = many1Till(p, end);
  return attempt((ctx) =>
    start(ctx) === FAIL || noSpace(ctx) === FAIL ? FAIL : body(ctx),
  );
}

const ampersand = char('&');
/**
 * Text between `open` and `close`, pairs of them inside balanced and kept,
 * each character read by `parser`.
 *
 * @see Text.Pandoc.Parsing.General.charsInBalanced
 * @param {string} open
 * @param {string} close
 * @param {Parser<string>} parser
 * @returns {Parser<string>}
 */
export function charsInBalanced(open, close, parser) {
  const notDelimiter = notFollowedBy(satisfy((c) => c === open || c === close));
  const run = many1((ctx) => (notDelimiter(ctx) === FAIL ? FAIL : parser(ctx)));
  const nested = (ctx) => {
    const inner = balanced(ctx);
    return inner === FAIL ? FAIL : open + inner + close;
  };
  const chunks = many(
    alt((ctx) => {
      const xs = run(ctx);
      return xs === FAIL ? FAIL : xs.join('');
    }, nested),
  );
  const [opening, closing] = [char(open), char(close)];
  const balanced = attempt((ctx) => {
    if (opening(ctx) === FAIL) return FAIL;
    const xs = chunks(ctx);
    return xs === FAIL || closing(ctx) === FAIL ? FAIL : xs.join('');
  });
  return balanced;
}

const referenceBody = many1Till(nonspaceChar, char(';'));

/**
 * A character reference, `&name;` or `&#n;`, as the text it stands for.
 *
 * @see Text.Pandoc.Parsing.General.characterReference
 * @type {Parser<string>}
 */
export const characterReference = attempt((ctx) => {
  if (ampersand(ctx) === FAIL) return FAIL;
  const body = referenceBody(ctx);
  if (body === FAIL) return FAIL;
  return lookupEntity(`${body.join('')};`) ?? FAIL;
});

/**
 * A character reference, as a `Str` of the text it stands for.
 *
 * @see Text.Pandoc.Parsing.General.charRef
 */
export function charRef(ctx) {
  const start = ctx.pos;
  const t = characterReference(ctx);
  return t === FAIL ? FAIL : B.str(t, start, ctx.pos);
}

/**
 * The text `p` reads.
 *
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<string>}
 */
export function textOf(p) {
  return (ctx) => {
    const start = ctx.pos;
    return p(ctx) === FAIL ? FAIL : ctx.text.slice(start, ctx.pos);
  };
}

/**
 * A line, its newline read and left out.
 *
 * @see Text.Pandoc.Parsing.General.anyLine
 * @type {Parser<string>}
 */
export function anyLine(ctx) {
  const { text, pos } = ctx;
  const end = text.indexOf('\n', pos);
  if (end === -1) return FAIL;
  ctx.pos = end + 1;
  return text.slice(pos, end);
}

/**
 * A line, its newline kept.
 *
 * @see Text.Pandoc.Parsing.General.anyLineNewline
 * @type {Parser<string>}
 */
export function anyLineNewline(ctx) {
  const line = anyLine(ctx);
  return line === FAIL ? FAIL : `${line}\n`;
}

/**
 * Exactly `n` spaces, or nothing read. Pandoc expands a tab here; the
 * reader's input holds none.
 *
 * @see Text.Pandoc.Parsing.General.gobbleSpaces
 * @param {Context} ctx
 * @param {number} n
 * @returns {undefined | typeof FAIL}
 */
export function gobbleSpaces(ctx, n) {
  for (let k = 0; k < n; k++) {
    if (ctx.text[ctx.pos + k] !== ' ') return FAIL;
  }
  ctx.pos += n;
  return undefined;
}

/**
 * Up to `n` spaces: how many. Pandoc expands a tab here; the reader's input
 * holds none.
 *
 * @see Text.Pandoc.Parsing.General.gobbleAtMostSpaces
 * @param {Context} ctx
 * @param {number} n
 * @returns {number}
 */
export function gobbleAtMostSpaces(ctx, n) {
  let k = 0;
  while (k < n && ctx.text[ctx.pos] === ' ') {
    ctx.pos++;
    k++;
  }
  return k;
}

const bar = char('|');

// A line block's continuation: a space, then a line. A space joins it to
// the line before, standing for the newline and the space.
function continuation(ctx) {
  const at = ctx.pos;
  if (ctx.text[at] !== ' ') return FAIL;
  ctx.pos++;
  const line = anyLine(ctx);
  if (line === FAIL) {
    ctx.pos = at;
    return FAIL;
  }
  return SourceText.concat([
    SourceText.synth(' ', at - 1, at + 1),
    SourceText.slice(ctx.text, at + 1, at + 1 + line.length),
  ]);
}

/**
 * A line block's line: `| `, then a line not blank and the continuations
 * after it. The spaces leading it are non-breaking.
 *
 * @see Text.Pandoc.Parsing.General.lineBlockLine
 * @type {Parser<SourceText>}
 */
const lineBlockLine = attempt((ctx) => {
  if (bar(ctx) === FAIL || ctx.text[ctx.pos] !== ' ') return FAIL;
  ctx.pos++;
  const parts = [];
  for (let at = ctx.pos; spaceChar(ctx) !== FAIL; at = ctx.pos) {
    parts.push(SourceText.synth(NBSP, at, ctx.pos));
  }
  const from = ctx.pos;
  if (ctx.text[from] === '\n') return FAIL;
  const line = anyLine(ctx);
  if (line === FAIL) return FAIL;
  parts.push(SourceText.slice(ctx.text, from, from + line.length));
  for (let next = continuation(ctx); next !== FAIL; next = continuation(ctx)) {
    parts.push(next);
  }
  return SourceText.concat(parts);
});

/**
 * A line block's blank line, `|` alone: its newline.
 *
 * @see Text.Pandoc.Parsing.General.blankLineBlockLine
 * @type {Parser<SourceText>}
 */
const blankLineBlockLine = attempt((ctx) =>
  bar(ctx) === FAIL || blankline(ctx) === FAIL
    ? FAIL
    : SourceText.slice(ctx.text, ctx.pos - 1, ctx.pos),
);

const lineBlockLineOrBlank = many1(alt(lineBlockLine, blankLineBlockLine));
const skipBlanklines = skipMany(blankline);

/**
 * A line block's lines, and the blank lines after them.
 *
 * @see Text.Pandoc.Parsing.General.lineBlockLines
 * @type {Parser<SourceText[]>}
 */
export const lineBlockLines = (ctx) => {
  const lines = lineBlockLineOrBlank(ctx);
  if (lines !== FAIL) skipBlanklines(ctx);
  return lines;
};

/**
 * The attributes of a heading of `inlines`: with `auto_identifiers`, an
 * identifier made from its text where it has none; either way recorded as
 * used. An identifier given that is used already is logged, of the heading
 * at `span`.
 *
 * Not ported yet: `ascii_identifiers`, off by default.
 *
 * @see Text.Pandoc.Parsing.General.registerHeader
 * @param {Context} ctx
 * @param {import('./state.js').Attr} attr
 * @param {import('../ast/nodes.js').Node[]} inlines
 * @param {[number, number]} span
 * @returns {import('./state.js').Attr}
 */
export function registerHeader(ctx, [ident, classes, pairs], inlines, span) {
  const used = ctx.state.identifiers;
  const auto = ident === '' && enabled(ctx, 'auto_identifiers');
  const id = auto ? uniqueIdent(inlines, used) : ident;
  if (!auto && id !== '' && used.has(id)) {
    const [start, end] = span;
    const fields = { contents: id, pos: ctx.pos };
    logMessage(ctx, message('DuplicateIdentifier', start, end, fields));
  }
  if (id !== '') updateState(ctx, { identifiers: used.set(id, true) });
  return [id, classes, pairs];
}

/**
 * Where the line holding `pos` ends: its newline, or the text's end.
 *
 * @param {string} text
 * @param {number} pos
 */
export function lineEnd(text, pos) {
  const end = text.indexOf('\n', pos);
  return end === -1 ? text.length : end;
}

/**
 * `parser` run on `source`, text extracted to be parsed again, in its own
 * offsets; the nodes it returns spanning the text `source` was extracted
 * from, carriage returns left out of it as Pandoc's `toSources` leaves them.
 * A failure leaves the position where the extraction left it. The chunk is
 * one level deeper: Parsec's source name, which positions compare by.
 *
 * @see Text.Pandoc.Parsing.General.parseFromString
 * @template T
 * @param {Context} ctx
 * @param {Parser<T>} parser
 * @param {import('../source-text.js').SourceText} extracted
 * @returns {T | typeof FAIL}
 */
export function parseFromString(ctx, parser, extracted) {
  const source = extracted.withoutCarriageReturns();
  const { text, pos, depth = 0, notesDefined } = ctx;
  const before = ctx.state;
  const logged = logOf(ctx)?.length ?? 0;
  ctx.text = source.text;
  ctx.pos = 0;
  ctx.depth = depth + 1;
  ctx.notesDefined = [];
  const x = parser(ctx);
  const defined = ctx.notesDefined;
  ctx.text = text;
  ctx.pos = pos;
  ctx.depth = depth;
  ctx.notesDefined = notesDefined;
  const toStart = (offset) => source.toOuterStart(offset);
  const toEnd = (offset) => source.toOuterEnd(offset);
  mapLogged(ctx, logged, toStart, toEnd);
  if (x === FAIL) return FAIL;
  mapNotes(ctx, defined, toStart, toEnd, source);
  mapHeld(ctx, before, toStart, toEnd);
  const mapped = mapSpans(x, toStart, toEnd, source);
  return Array.isArray(mapped) ? withContents(mapped, source) : mapped;
}

// The lists a read holds in its state, whose items carry spans: what a
// read of extracted text adds to them maps out with its blocks.
const HELD = ['definitions', 'noteDefinitions', 'logMessages'];

/**
 * An item with its spans mapped: `start`, `end` and `pos`, and each
 * `[start, end]` pair among its fields.
 *
 * @template {object} T
 * @param {T} item
 * @param {(offset: number) => number} toStart
 * @param {(offset: number) => number} toEnd
 * @returns {T}
 */
export function mapItemSpans(item, toStart, toEnd) {
  const out = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === 'start' || key === 'pos') out[key] = toStart(value);
    else if (key === 'end') out[key] = toEnd(value);
    else if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every(Number.isInteger)
    ) {
      out[key] = [toStart(value[0]), toEnd(value[1])];
    } else out[key] = value;
  }
  return /** @type {T} */ (out);
}

/**
 * The items a read of extracted text added to each held list, those before
 * `since`'s, mapped out to the text it was extracted from.
 *
 * @param {Context} ctx
 * @param {Record<string, unknown>} since The state before the read.
 * @param {(offset: number) => number} toStart
 * @param {(offset: number) => number} toEnd
 */
function mapHeld(ctx, since, toStart, toEnd) {
  const fields = {};
  for (const name of HELD) {
    const added = [];
    for (let at = ctx.state[name]; at !== since[name] && at; at = at.next) {
      added.push(at.item);
    }
    if (added.length === 0) continue;
    let list = since[name];
    for (const item of added.reverse()) {
      list = { item: mapItemSpans(item, toStart, toEnd), next: list };
    }
    fields[name] = list;
  }
  if (Object.keys(fields).length > 0) updateState(ctx, fields);
}

// The messages logged since the first `logged`, by a read of extracted
// text, failed or not, mapped out to the text it was extracted from.
function mapLogged(ctx, logged, toStart, toEnd) {
  const log = logOf(ctx);
  for (let k = logged; log && k < log.length; k++) {
    log[k] = mapItemSpans(log[k], toStart, toEnd);
  }
}

/**
 * The notes a read of extracted text defined, mapped out to the text it
 * was extracted from, as its blocks are: a note's contents are filled into
 * the document once reading ends, from the state. A note the state no
 * longer holds as defined, the read backtracked from.
 *
 * @param {Context} ctx
 * @param {[string, unknown][]} defined Each label and contents defined.
 * @param {(offset: number) => number} toStart
 * @param {(offset: number) => number} toEnd
 * @param {import('../source-text.js').SourceText} source
 */
function mapNotes(ctx, defined, toStart, toEnd, source) {
  let { notes } = ctx.state;
  for (const [label, contents] of defined) {
    if (notes.get(label) !== contents) continue;
    const mapped = mapSpans(contents, toStart, toEnd, source);
    notes = notes.set(label, mapped);
    ctx.notesDefined?.push([label, mapped]);
  }
  if (notes !== ctx.state.notes) updateState(ctx, { notes });
}

/**
 * `parseFromString` with no `str` before it, the one outside kept for after.
 *
 * @see Text.Pandoc.Parsing.General.parseFromString'
 * @template T
 * @param {Context} ctx
 * @param {Parser<T>} parser
 * @param {import('../source-text.js').SourceText} source
 * @returns {T | typeof FAIL}
 */
export function parseFromStringFresh(ctx, parser, source) {
  const outer = ctx.state.lastStrPos;
  updateState(ctx, { lastStrPos: null });
  const x = parseFromString(ctx, parser, source);
  updateState(ctx, { lastStrPos: outer });
  return x;
}

// A line of spaces and tabs alone: `blankline`'s, not every Unicode space.
const BLANK = /^[ \t]*$/;

/**
 * Where what was read from `from` to `to` ends as a block: its last line
 * not blank, the newline left out.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} to
 */
export function lastLineEnd(text, from, to) {
  let end = to;
  for (;;) {
    while (end > from && text[end - 1] === '\n') end--;
    if (end === from) return end;
    const lineStart = text.lastIndexOf('\n', end - 1) + 1;
    if (lineStart <= from || !BLANK.test(text.slice(lineStart, end))) {
      return end;
    }
    end = lineStart;
  }
}

/**
 * Where a block read from `from` to `to` ends: its last line not blank,
 * or where its last child does, whichever is later; a line break the block
 * keeps at its end spans the newline.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @param {import('../ast/nodes.js').Node[]} children
 */
export function blockEnd(text, from, to, children) {
  return Math.max(lastLineEnd(text, from, to), children.at(-1)?.end ?? from);
}
