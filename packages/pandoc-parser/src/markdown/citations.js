// Citations, `[see @key, p. 3; -@other]` in brackets or `@key [p. 3]` in
// text, and example references, `@label`.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `inlines.js`
// and `links.js` import this module, which imports them: what they import
// from here is a function declaration, and what this reads from them, it
// reads when called.

import * as B from '../ast/builder.js';
import {
  AuthorInText,
  citation,
  NormalCitation,
  SuppressAuthor,
} from '../ast/nodes.js';
import { alphaNum, char, isSpace, oneOf } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  many1,
  manyTill,
  notFollowedBy,
  option,
  optional,
  sepBy1,
} from '../core.js';
import { citeKey } from '../parsing/citations.js';
import {
  nonspaceChar,
  parseFromStringFresh,
  textOf,
} from '../parsing/general.js';
import { enabled, updateState, whenEnabled } from '../parsing/state.js';
import { SourceText } from '../source-text.js';
import { attributes } from './attributes.js';
import { spnl } from './common.js';
import { inline, inlines } from './inlines.js';
import { reference, referenceLink, source } from './links.js';
import { lookupTables } from './references.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @typedef {ReturnType<typeof citation>} Citation */

const semicolon = char(';');
const closeBracket = char(']');
const openBracket = char('[');
const noSemicolon = notFollowedBy(semicolon);
const separator = attempt((ctx) =>
  semicolon(ctx) === FAIL ? FAIL : spnl(ctx),
);
const maybeSeparator = optional(separator);
const keyAhead = lookAhead(
  attempt((ctx) => (maybeSeparator(ctx) === FAIL ? FAIL : citeKey(ctx))),
);
const prefixInlines = manyTill(
  (ctx) => (noSemicolon(ctx) === FAIL ? FAIL : inline(ctx)),
  alt(closeBracket, keyAhead),
);

/**
 * A citation's prefix: inlines up to its key, or a `]`, read.
 *
 * @see Text.Pandoc.Readers.Markdown.prefix
 * @param {Context} ctx
 */
function prefix(ctx) {
  const read = prefixInlines(ctx);
  return read === FAIL ? FAIL : B.trimInlines(B.concat(read));
}

const noNonspace = notFollowedBy(nonspaceChar);
const spaceFirst = option(false, (ctx) =>
  noNonspace(ctx) === FAIL ? FAIL : true,
);
const noEnd = notFollowedBy(oneOf(';]'));
const suffixInlines = many((ctx) => (noEnd(ctx) === FAIL ? FAIL : inline(ctx)));

/**
 * A citation's suffix: inlines up to a `;` or `]`, a space before them
 * where one was.
 *
 * @see Text.Pandoc.Readers.Markdown.suffix
 */
const suffix = attempt((ctx) => {
  const start = ctx.pos;
  const hasSpace = spaceFirst(ctx);
  if (spnl(ctx) === FAIL) return FAIL;
  const read = suffixInlines(ctx);
  if (read === FAIL) return FAIL;
  const rest = B.trimInlines(B.concat(read));
  if (!hasSpace || read.length === 0) return rest;
  return B.concat([B.space(start, start + 1), rest]);
});

/**
 * A citation: a prefix, its key, a suffix.
 *
 * @see Text.Pandoc.Readers.Markdown.citation
 */
const oneCitation = attempt((ctx) => {
  const pre = prefix(ctx);
  if (pre === FAIL) return FAIL;
  const key = citeKey(ctx);
  if (key === FAIL) return FAIL;
  const suf = suffix(ctx);
  if (suf === FAIL) return FAIL;
  return citation({
    id: key.key,
    prefix: pre,
    suffix: suf,
    mode: key.suppress ? SuppressAuthor : NormalCitation,
    noteNum: ctx.state.noteNumber,
  });
});

/**
 * Citations separated by `;`.
 *
 * @see Text.Pandoc.Readers.Markdown.citeList
 */
const citeList = sepBy1(oneCitation, separator);

const notLinkAfter = notFollowedBy(
  alt(
    attempt((ctx) => source(ctx)),
    whenEnabled('bracketed_spans', attributes),
    (ctx) => reference(ctx),
  ),
);

/**
 * Citations in brackets, not a link's text or a span's.
 *
 * @see Text.Pandoc.Readers.Markdown.normalCite
 * @param {Context} ctx
 * @returns {Citation[] | typeof FAIL}
 */
export function normalCite(ctx) {
  return normalCiteAt(ctx);
}

const normalCiteAt = attempt((ctx) => {
  if (openBracket(ctx) === FAIL || spnl(ctx) === FAIL) return FAIL;
  const citations = citeList(ctx);
  if (citations === FAIL || spnl(ctx) === FAIL) return FAIL;
  if (closeBracket(ctx) === FAIL || notLinkAfter(ctx) === FAIL) return FAIL;
  return citations;
});

const noCaret = notFollowedBy(char('^'));
const moreCitations = option(
  [],
  attempt((ctx) =>
    semicolon(ctx) === FAIL || spnl(ctx) === FAIL ? FAIL : citeList(ctx),
  ),
);
const noLinkOpen = notFollowedBy(oneOf('[({'));

/**
 * A textual citation's locator in brackets after it: its suffix, and the
 * citations after it.
 *
 * @see Text.Pandoc.Readers.Markdown.bareloc
 * @param {Citation} first
 * @returns {import('../core.js').Parser<Citation[]>}
 */
const bareloc = (first) =>
  attempt((ctx) => {
    if (spnl(ctx) === FAIL || openBracket(ctx) === FAIL) return FAIL;
    if (noCaret(ctx) === FAIL) return FAIL;
    const suf = suffix(ctx);
    if (suf === FAIL) return FAIL;
    const rest = moreCitations(ctx);
    if (rest === FAIL || spnl(ctx) === FAIL) return FAIL;
    if (closeBracket(ctx) === FAIL || noLinkOpen(ctx) === FAIL) return FAIL;
    return [{ ...first, citationSuffix: suf }, ...rest];
  });

const spacedNormalCite = attempt((ctx) =>
  spnl(ctx) === FAIL ? FAIL : normalCite(ctx),
);

// `@` and the key, as Pandoc writes it into a citation's text: its key's
// source span, braces and all.
const atKey = (key, start, end) => B.str(`@${key}`, start, end);

/**
 * A citation in text, `@key`, and what follows in brackets: a locator,
 * citations, or a reference link's target, which makes it a link after
 * the citation. A key an example already has is that example's.
 *
 * @see Text.Pandoc.Readers.Markdown.textualCite
 */
const textualCite = attempt((ctx) => {
  const start = ctx.pos;
  const read = citeKey(ctx);
  if (read === FAIL) return FAIL;
  const { suppress, key } = read;
  if (ctx.state.examples.has(key)) return FAIL;
  const keyEnd = ctx.pos;
  const noteNum = ctx.state.noteNumber;
  const first = citation({
    id: key,
    mode: suppress ? SuppressAuthor : AuthorInText,
    noteNum,
  });
  const atFirst = () => atKey(key, start, keyEnd);
  const following = alt((c) => {
    const cs = spacedNormalCite(c);
    return cs === FAIL ? FAIL : [first, ...cs];
  }, bareloc(first))(ctx);
  if (following === FAIL) {
    const n = lookupTables(ctx).examples.get(key);
    if (n !== undefined) return B.str(String(n), start, keyEnd);
    return B.cite([first], atFirst(), start, keyEnd);
  }
  const end = ctx.pos;
  let from = keyEnd;
  while (from < end && isSpace(ctx.text[from])) from++;
  const bracketed = SourceText.slice(ctx.text, from + 1, end - 1);
  const label = parseFromStringFresh(ctx, inlines, bracketed);
  if (label === FAIL) return FAIL;
  const raw = ctx.text.slice(from, end);
  const ref = { label, raw, from, to: end };
  const fallback = referenceLink(ctx, B.linkWith, ref, from);
  if (fallback === FAIL) return FAIL;
  updateState(ctx, { noteNumber: noteNum });
  const spaced = from > keyEnd ? B.space(keyEnd, from) : [];
  if (fallback[0]?.t === 'Link') {
    return B.concat([
      B.cite([first], atFirst(), start, keyEnd),
      spaced,
      fallback,
    ]);
  }
  // Pandoc's `B.text ("@" <> key <> " " <> raw)`: the gap a soft break
  // where a line break is in it.
  const gap = /[\r\n]/.test(ctx.text.slice(keyEnd, from))
    ? B.softbreak(keyEnd, from)
    : B.space(keyEnd, from);
  const text = B.concat([atFirst(), gap, B.text(raw, from)]);
  return B.cite(following, text, start, ctx.pos);
});

/**
 * A citation: in text, or in brackets. Outside a note, it counts as one:
 * a citation style may make it a note.
 *
 * @see Text.Pandoc.Readers.Markdown.cite
 * @param {Context} ctx
 */
export function cite(ctx) {
  if (!enabled(ctx, 'citations')) return FAIL;
  if (!ctx.state.inNote) {
    updateState(ctx, { noteNumber: ctx.state.noteNumber + 1 });
  }
  const textual = textualCite(ctx);
  if (textual !== FAIL) return textual;
  const start = ctx.pos;
  const citations = normalCite(ctx);
  if (citations === FAIL) return FAIL;
  const raw = ctx.text.slice(start, ctx.pos);
  return B.cite(citations, B.text(raw, start), start, ctx.pos);
}

const at = char('@');
const alphaNums = textOf(many1(alphaNum));
const joiner = oneOf('_-');
const labelPart = alt(
  alphaNums,
  attempt((ctx) => {
    const c = joiner(ctx);
    if (c === FAIL) return FAIL;
    const rest = alphaNums(ctx);
    return rest === FAIL ? FAIL : c + rest;
  }),
);
const label = many(labelPart);

/**
 * `@label`: its example's number, or itself where no example has it.
 *
 * @see Text.Pandoc.Readers.Markdown.exampleRef
 * @param {Context} ctx
 */
export function exampleRef(ctx) {
  return exampleRefAt(ctx);
}

const exampleRefAt = whenEnabled(
  'example_lists',
  attempt((ctx) => {
    const start = ctx.pos;
    if (at(ctx) === FAIL) return FAIL;
    const parts = label(ctx);
    if (parts === FAIL) return FAIL;
    const name = parts.join('');
    const n = lookupTables(ctx).examples.get(name);
    const text = n === undefined ? `@${name}` : String(n);
    return B.str(text, start, ctx.pos);
  }),
);
