// Metadata in Markdown: the `%` title block at the start, and YAML
// metadata blocks, later keys replacing earlier ones.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`, and its
// `Text.Pandoc.Readers.Metadata.yamlMetaBlock`.

import * as B from '../ast/builder.js';
import { char, newline, spaces, string } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  manyTill,
  notFollowedBy,
  option,
  sepEndBy,
} from '../core.js';
import { message, report } from '../logging.js';
import { yamlBsToMeta } from '../metadata.js';
import {
  anyLine,
  blankline,
  lastLineEnd,
  notAhead,
  optionalBlanklines,
  parseFromStringFresh,
  skipSpaces,
  spaceChar,
} from '../parsing/general.js';
import { updateState, whenEnabled } from '../parsing/state.js';
import { SourceText } from '../source-text.js';
import { parseBlocks } from './blocks.js';
import { inline, inlines } from './inlines.js';

/** @typedef {import('../core.js').Context} Context */

// Metadata added, its keys replacing those before: `Meta`'s `<>` is
// right-biased, whatever `Markdown.hs`'s comment says.
function addMeta(ctx, meta) {
  ctx.state = { ...ctx.state, meta: { ...ctx.state.meta, ...meta } };
}

// Text read again as the document's blocks; null where that fails.
const readBlocks = (ctx) => (source) => {
  const bs = parseFromStringFresh(ctx, parseBlocks, source);
  return bs === FAIL ? null : bs;
};

const continuation = attempt((ctx) => {
  if (spaceChar(ctx) === FAIL) return FAIL;
  if (notAhead(blankline)(ctx) === FAIL || skipSpaces(ctx) === FAIL)
    return FAIL;
  const start = ctx.pos;
  return anyLine(ctx) === FAIL ? FAIL : [start, ctx.pos - 1];
});

/**
 * A `%` line and the indented lines continuing it, joined by newlines and
 * trimmed: what each holds after its leading spaces.
 *
 * @see Text.Pandoc.Readers.Markdown.rawTitleBlockLine
 * @type {import('../core.js').Parser<SourceText>}
 */
function rawTitleBlockLine(ctx) {
  if (char('%')(ctx) === FAIL || skipSpaces(ctx) === FAIL) return FAIL;
  const start = ctx.pos;
  if (anyLine(ctx) === FAIL) return FAIL;
  const first = [start, ctx.pos - 1];
  const rest = many(continuation)(ctx);
  if (rest === FAIL) return FAIL;
  const { text } = ctx;
  // Each line with the newline after it.
  const lines = [first, ...rest].map(([s, e]) =>
    SourceText.slice(text, s, e + 1),
  );
  const joined = SourceText.concat(lines);
  let [from, to] = [0, joined.text.length];
  const ws = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  while (from < to && ws(joined.text[from])) from++;
  while (to > from && ws(joined.text[to - 1])) to--;
  return joined.cut(from, to);
}

// A title block line's inlines, trimmed.
const inlinesLine = attempt((ctx) => {
  const raw = rawTitleBlockLine(ctx);
  if (raw === FAIL) return FAIL;
  const res = parseFromStringFresh(ctx, inlines, raw);
  return res === FAIL ? FAIL : B.trimInlines(res);
});

const authorSep = alt(
  (ctx) => (char(';')(ctx) === FAIL ? FAIL : spaces(ctx)),
  newline,
);
const notAuthorSep = notFollowedBy(authorSep);
const author = (ctx) => {
  const xs = many(
    attempt((c) => (notAuthorSep(c) === FAIL ? FAIL : inline(c))),
  )(ctx);
  return xs === FAIL ? FAIL : B.trimInlines(B.concat(xs));
};
const pAuthors = sepEndBy(author, authorSep);

/**
 * The title block's authors, separated by semicolons or lines.
 *
 * @see Text.Pandoc.Readers.Markdown.authorsLine
 * @type {import('../core.js').Parser<B.Inlines[]>}
 */
const authorsLine = attempt((ctx) => {
  const raw = rawTitleBlockLine(ctx);
  if (raw === FAIL) return FAIL;
  return parseFromStringFresh(ctx, pAuthors, raw);
});

const titleLine = inlinesLine;
const dateLine = inlinesLine;

/**
 * `% title`, `% authors` and `% date`, each optional, as metadata.
 *
 * @see Text.Pandoc.Readers.Markdown.pandocTitleBlock
 * @type {import('../core.js').Parser<undefined>}
 */
const pandocTitleBlock = whenEnabled('pandoc_title_block', (ctx) => {
  if (lookAhead(char('%'))(ctx) === FAIL) return FAIL;
  const start = ctx.pos;
  return attempt((c) => {
    const title = option([], titleLine)(c);
    if (title === FAIL) return FAIL;
    const authors = option([], authorsLine)(c);
    if (authors === FAIL) return FAIL;
    const date = option([], dateLine)(c);
    if (date === FAIL || optionalBlanklines(c) === FAIL) return FAIL;
    const meta = {};
    if (date.length > 0) meta.date = B.metaInlines(date);
    if (authors.length > 0) {
      meta.author = { t: 'MetaList', c: authors.map(B.metaInlines) };
    }
    if (title.length > 0) meta.title = B.metaInlines(title);
    addMeta(c, meta);
    held(c, 'title', start);
    return undefined;
  })(ctx);
});

/**
 * A title block: Pandoc's. Not ported yet: MultiMarkdown's, off by
 * default.
 *
 * @see Text.Pandoc.Readers.Markdown.titleBlock
 */
export const titleBlock = pandocTitleBlock;

const stopLine = attempt((ctx) =>
  alt(string('---'), string('...'))(ctx) === FAIL ? FAIL : blankline(ctx),
);
const yamlLines = manyTill(anyLine, stopLine);
const notBlankline = notFollowedBy(blankline);

/**
 * `---`, YAML, then `---` or `...`: its metadata. A `---` before a blank
 * line is a rule.
 *
 * @see Text.Pandoc.Readers.Metadata.yamlMetaBlock
 * @type {import('../core.js').Parser<Record<string, unknown>>}
 */
const yamlMetaBlock = attempt((ctx) => {
  const at = ctx.pos;
  if (string('---')(ctx) === FAIL || blankline(ctx) === FAIL) return FAIL;
  const body = ctx.pos;
  if (notBlankline(ctx) === FAIL) return FAIL;
  const lines = yamlLines(ctx);
  if (lines === FAIL) return FAIL;
  // by including --- and ..., we allow yaml blocks with just comments:
  const raw = ['---', ...lines, '...'].map((l) => `${l}\n`).join('');
  if (optionalBlanklines(ctx) === FAIL) return FAIL;
  // Values span nothing where the block starts: in a container, in its
  // text's offsets.
  // The lines are as written, after `---\n`.
  const warn = (path, start, end) => {
    const [from, to] = [body + start - 4, body + end - 4];
    const fields = { message: `Duplicate key: ${path}`, pos: at };
    report(ctx, message('YamlWarning', from, to, fields));
  };
  const meta = yamlBsToMeta(readBlocks(ctx), raw, at, warn);
  return meta === null ? FAIL : meta;
});

/**
 * A YAML metadata block: its keys added where new; no blocks.
 *
 * @see Text.Pandoc.Readers.Markdown.yamlMetaBlock'
 * @type {import('../core.js').Parser<B.Blocks>}
 */
export const yamlMetaBlockPrime = whenEnabled('yaml_metadata_block', (ctx) => {
  const start = ctx.pos;
  const meta = yamlMetaBlock(ctx);
  if (meta === FAIL) return FAIL;
  addMeta(ctx, meta);
  held(ctx, 'yaml', start);
  return [];
});

// Record a metadata block of `kind` read from `start` to here, its blank
// lines after it left out: where it is, for a consumer to find.
function held(ctx, kind, start) {
  const item = { kind, start, end: lastLineEnd(ctx.text, start, ctx.pos) };
  updateState(ctx, {
    metadataBlocks: { item, next: ctx.state.metadataBlocks },
  });
}
