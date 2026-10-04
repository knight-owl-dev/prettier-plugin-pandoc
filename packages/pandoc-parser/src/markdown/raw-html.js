// Raw HTML in markdown: tags and comments as raw inlines, `<span>` as a
// span, and what an open HTML block's closing tag ends.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `inlines.js`
// imports this module, which imports it: what it imports from here is a
// function declaration, and what this reads from it, it reads when called.

import * as B from '../ast/builder.js';
import { isSpace } from '../char.js';
import { attempt, FAIL, manyTill } from '../core.js';
import { htmlTag, isInlineTag, isTextTag } from '../html.js';
import { enabled } from '../parsing/state.js';
import { words } from '../shared.js';
import { tagMatches } from '../tagsoup/parser.js';
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
  const attrs = open.tag.attrs;
  const value = (name) => attrs.find(([k]) => k === name)?.[1];
  const attr = [
    value('id') ?? '',
    words(value('class') ?? ''),
    attrs.filter(([k]) => k !== 'id' && k !== 'class'),
  ];
  return wrapSpan(attr, B.concat(contents), start, ctx.pos);
});
