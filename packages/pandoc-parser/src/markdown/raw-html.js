// Raw HTML in markdown: tags and comments as raw inlines and HTML elements
// as raw blocks, markdown inside block tags read as blocks, `<span>` and
// `<div>` as spans and divs, and what an open HTML block's closing tag ends.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `blocks.js` and
// `inlines.js` import this module, which imports them: what they import
// from here is a function declaration, and what this reads from them, it
// reads when called.

import * as B from '../ast/builder.js';
import { isSpace } from '../char.js';
import { attempt, FAIL, many, manyTill } from '../core.js';
import {
  htmlInBalanced,
  htmlTag,
  isBlockTag,
  isInlineTag,
  isTextTag,
  renderTags,
  VOID_TAGS,
} from '../html.js';
import {
  blankline,
  blockEnd,
  gobbleAtMostSpaces,
  notAhead,
  optionalBlanklines,
  skipSpaces,
} from '../parsing/general.js';
import { enabled, updateState } from '../parsing/state.js';
import { words } from '../shared.js';
import { parseTags, tagMatches } from '../tagsoup/parser.js';
import { block } from './blocks.js';
import { inline } from './inlines.js';
import { wrapSpan } from './links.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../tagsoup/parser.js').Tag} Tag */

const closeTag = (name) => ({ t: 'TagClose', name });

// Whether `tag` closes the open HTML block.
const closesBlock = (ctx, tag) => {
  const open = ctx.state.inHtmlBlock;
  return open !== null && tagMatches(tag, closeTag(open));
};

/**
 * No closing tag of the open HTML block here.
 *
 * @see Text.Pandoc.Readers.Markdown.notFollowedByHtmlCloser
 * @param {Context} ctx
 */
export function notFollowedByHtmlCloser(ctx) {
  if (ctx.state.inHtmlBlock === null) return undefined;
  const { pos, state } = ctx;
  const found = htmlTag(ctx, (tag) => closesBlock(ctx, tag));
  [ctx.pos, ctx.state] = [pos, state];
  return found === FAIL ? undefined : FAIL;
}

/**
 * A tag or comment as a raw inline; none where it is only spaces. With
 * `markdown_in_html_blocks`, only an inline tag, and not the open block's
 * closing one: block tags open blocks.
 *
 * @see Text.Pandoc.Readers.Markdown.rawHtmlInline
 * @param {Context} ctx
 */
export function rawHtmlInline(ctx) {
  if (!enabled(ctx, 'raw_html')) return FAIL;
  const mdInHtml =
    enabled(ctx, 'markdown_in_html_blocks') ||
    enabled(ctx, 'markdown_attribute');
  const start = ctx.pos;
  const found = htmlTag(ctx, (tag) =>
    mdInHtml ? isInlineTag(tag) && !closesBlock(ctx, tag) : !isTextTag(tag),
  );
  if (found === FAIL) return FAIL;
  if ([...found.raw].every(isSpace)) return [];
  return B.rawInline('html', found.raw, start, ctx.pos);
}

const SPAN_OPEN = { t: 'TagOpen', name: 'span', attrs: [] };
const SPAN_CLOSE = closeTag('span');
const spanClose = (ctx) => htmlTag(ctx, (tag) => tagMatches(tag, SPAN_CLOSE));
const spanContents = manyTill((ctx) => inline(ctx), spanClose);

/**
 * `<span>`, inlines, `</span>`: a span of the tag's attributes, as
 * `wrapSpan` makes one.
 *
 * @see Text.Pandoc.Readers.Markdown.spanHtml
 * @param {Context} ctx
 */
export function spanHtml(ctx) {
  return enabled(ctx, 'native_spans') ? spanHtmlAt(ctx) : FAIL;
}

const spanHtmlAt = attempt((ctx) => {
  const start = ctx.pos;
  const open = htmlTag(ctx, (tag) => tagMatches(tag, SPAN_OPEN));
  if (open === FAIL) return FAIL;
  const contents = spanContents(ctx);
  if (contents === FAIL) return FAIL;
  return wrapSpan(attrOf(open.tag.attrs), B.concat(contents), start, ctx.pos);
});

const isVerbTag = (tag) =>
  tag.t === 'TagOpen' &&
  ['pre', 'style', 'script', 'textarea'].includes(tag.name);

/**
 * `<pre>`, `<style>`, `<script>` or `<textarea>` to its closing tag, as
 * written: nothing in it read as markdown.
 *
 * @see Text.Pandoc.Readers.Markdown.rawVerbatimBlock
 * @param {Context} ctx
 */
const rawVerbatimBlock = (ctx) => htmlInBalanced(ctx, isVerbTag);

/**
 * An element of a block tag to its closing tag, as written.
 *
 * @see Text.Pandoc.Readers.Markdown.strictHtmlBlock
 * @param {Context} ctx
 */
const strictHtmlBlock = (ctx) =>
  htmlInBalanced(ctx, (tag) => !isInlineTag(tag));

/**
 * A verbatim element, a block tag's element, or a block tag alone, as
 * written.
 *
 * @see Text.Pandoc.Readers.Markdown.htmlElement
 * @param {Context} ctx
 */
function htmlElement(ctx) {
  const verbatim = rawVerbatimBlock(ctx);
  if (verbatim !== FAIL) return verbatim;
  const strict = strictHtmlBlock(ctx);
  if (strict !== FAIL) return strict;
  const found = htmlTag(ctx, isBlockTag);
  return found === FAIL ? FAIL : found.raw;
}

/**
 * An HTML element as a raw block, the spaces and blank lines after it read.
 *
 * @see Text.Pandoc.Readers.Markdown.htmlBlock'
 */
const htmlBlockRaw = attempt((ctx) => {
  const start = ctx.pos;
  const raw = htmlElement(ctx);
  if (raw === FAIL) return FAIL;
  const end = ctx.pos;
  skipSpaces(ctx);
  optionalBlanklines(ctx);
  return raw === '' ? [] : B.rawBlock('html', raw, start, end);
});

/**
 * An opening tag's text without a `markdown` attribute: rendered again,
 * as Pandoc renders it, whether it had one or not.
 *
 * @see Text.Pandoc.Readers.Markdown.stripMarkdownAttribute
 * @param {string} raw
 */
const stripMarkdownAttribute = (raw) =>
  renderTags(
    [...parseTags(raw)].map((tag) =>
      tag.t === 'TagOpen'
        ? { ...tag, attrs: tag.attrs.filter(([k]) => k !== 'markdown') }
        : tag,
    ),
  );

// A blank line, then spaces and tabs: the indentation they add up to, a
// tab a tab stop. Zero where no blank line follows.
function blockIndent(ctx) {
  if (blankline(ctx) === FAIL) return 0;
  let n = 0;
  for (;;) {
    const c = ctx.text[ctx.pos];
    if (c === ' ') n += 1;
    else if (c === '\t') n += ctx.state.options.tabStop;
    else return n;
    ctx.pos++;
  }
}

/**
 * A block tag, the blocks in it read as markdown, and its closing tag:
 * each tag a raw block. Where nothing closes it, the tag as written and
 * the blocks after it.
 *
 * @see Text.Pandoc.Readers.Markdown.rawHtmlBlocks
 * @param {Context} ctx
 */
function rawHtmlBlocks(ctx) {
  const start = ctx.pos;
  const opened = htmlTag(ctx, isBlockTag);
  if (opened === FAIL || opened.tag.t !== 'TagOpen') return FAIL;
  const { raw, tag } = opened;
  const openEnd = ctx.pos;
  skipSpaces(ctx);
  const indent = blockIndent(ctx);
  const outer = ctx.state.inHtmlBlock;
  updateState(ctx, { inHtmlBlock: tag.name });
  const closer = (c) => htmlTag(c, (t) => tagMatches(t, closeTag(tag.name)));
  const noCloser = notAhead(closer);
  const blocks = [];
  const empty = raw.endsWith('/>') || VOID_TAGS.has(tag.name);
  while (!empty) {
    const at = ctx.pos;
    const state = ctx.state;
    gobbleAtMostSpaces(ctx, indent);
    const read = noCloser(ctx) === FAIL ? FAIL : block(ctx);
    if (read === FAIL) {
      [ctx.pos, ctx.state] = [at, state];
      break;
    }
    blocks.push(read);
  }
  const contents = blocks.flat();
  const beforeClose = ctx.pos;
  gobbleAtMostSpaces(ctx, indent);
  const closeStart = ctx.pos;
  const closed = closer(ctx);
  let result;
  if (closed === FAIL) {
    ctx.pos = beforeClose;
    result = [...B.rawBlock('html', raw, start, openEnd), ...contents];
  } else {
    result = [
      ...B.rawBlock('html', stripMarkdownAttribute(raw), start, openEnd),
      ...contents,
      ...B.rawBlock('html', closed.raw, closeStart, ctx.pos),
    ];
  }
  updateState(ctx, { inHtmlBlock: outer });
  return result;
}

/**
 * HTML at a block's start: a verbatim element as a raw block; a block
 * tag's element with markdown inside it, with `markdown_in_html_blocks`;
 * else the element as written.
 *
 * Not ported yet: `markdown_attribute`, off by default.
 *
 * @see Text.Pandoc.Readers.Markdown.htmlBlock
 * @param {Context} ctx
 */
export function htmlBlock(ctx) {
  if (!enabled(ctx, 'raw_html')) return FAIL;
  const read = htmlBlockOpen(ctx);
  return read === FAIL ? htmlBlockRaw(ctx) : read;
}

const htmlBlockOpen = attempt((ctx) => {
  const { pos, state } = ctx;
  const opened = htmlTag(ctx, isBlockTag);
  [ctx.pos, ctx.state] = [pos, state];
  if (opened === FAIL || opened.tag.t !== 'TagOpen') return FAIL;
  const verbatim = rawVerbatimBlock(ctx);
  if (verbatim !== FAIL) return B.rawBlock('html', verbatim, pos, ctx.pos);
  if (!enabled(ctx, 'markdown_in_html_blocks')) return FAIL;
  return rawHtmlBlocks(ctx);
});

const DIV_OPEN = { t: 'TagOpen', name: 'div', attrs: [] };
const DIV_CLOSE = closeTag('div');
const divClose = (ctx) => htmlTag(ctx, (tag) => tagMatches(tag, DIV_CLOSE));
const noDivClose = notAhead(divClose);
const divContents = many((ctx) =>
  noDivClose(ctx) === FAIL ? FAIL : block(ctx),
);

/**
 * `<div>`, blocks, `</div>`: a div of the tag's attributes. Its closing
 * tag ends the blocks in it.
 *
 * @see Text.Pandoc.Readers.Markdown.divHtml
 * @param {Context} ctx
 */
export function divHtml(ctx) {
  return enabled(ctx, 'native_divs') ? divHtmlAt(ctx) : FAIL;
}

const divHtmlAt = attempt((ctx) => {
  const start = ctx.pos;
  const open = htmlTag(ctx, (tag) => tagMatches(tag, DIV_OPEN));
  if (open === FAIL) return FAIL;
  const outer = ctx.state.inHtmlBlock;
  updateState(ctx, { inHtmlBlock: 'div' });
  optionalBlanklines(ctx);
  const contents = divContents(ctx);
  if (contents === FAIL) return FAIL;
  divClose(ctx);
  updateState(ctx, { inHtmlBlock: outer });
  const blocks = contents.flat();
  const end = blockEnd(ctx.text, start, ctx.pos, blocks);
  return B.divWith(attrOf(open.tag.attrs), blocks, start, end);
});

// A tag's attributes as Pandoc's: `id` the identifier, `class` the
// classes, the rest key-value pairs.
function attrOf(attrs) {
  const value = (name) => attrs.find(([k]) => k === name)?.[1];
  return [
    value('id') ?? '',
    words(value('class') ?? ''),
    attrs.filter(([k]) => k !== 'id' && k !== 'class'),
  ];
}

/**
 * An open `<div>`'s closing tag ahead, with `native_divs`: what ends a
 * paragraph in it.
 *
 * @see Text.Pandoc.Readers.Markdown.para
 * @param {Context} ctx
 */
export function htmlDivCloserAhead(ctx) {
  if (!enabled(ctx, 'native_divs') || ctx.state.inHtmlBlock !== 'div') {
    return FAIL;
  }
  const { pos, state } = ctx;
  const found = divClose(ctx);
  [ctx.pos, ctx.state] = [pos, state];
  return found === FAIL ? FAIL : undefined;
}
