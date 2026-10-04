// The markdown reader's block parsers: each returns its blocks, every node
// spanning what it read. A block's span runs to the end of its last line,
// its newline left out.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. A parser not
// ported yet keeps its place in `block`'s choice as a comment.

import * as B from '../ast/builder.js';
import { newline } from '../char.js';
import {
  alt,
  attempt,
  choice,
  eof,
  FAIL,
  lookAhead,
  manyTill,
} from '../core.js';
import { blanklines, blockEnd, notAhead } from '../parsing/general.js';
import { whenEnabled } from '../parsing/state.js';
import { blockQuote } from './blockquote.js';
import { codeBlockFenced, codeBlockIndented } from './code.js';
import { definitionList } from './definition-lists.js';
import { divFenced, divFenceEnd, inDiv } from './divs.js';
import { header } from './headers.js';
import { hrule } from './hrule.js';
import { inlines1 } from './inlines.js';
import { bulletList, listStartInItem, orderedList } from './lists.js';

const divCloserAhead = lookAhead(divFenceEnd);

// Blank lines, which make no block.
const blank = (ctx) => (blanklines(ctx) === FAIL ? FAIL : []);

// A paragraph's end after its last line: a newline, then blank lines, a
// fence, with `lists_without_preceding_blankline` anything but a list start
// in a list item, or an open div's closing fence. Not ported yet, each
// needing a construct or a non-default extension: a block quote, an ATX
// heading, the closer of an open HTML block.
const paragraphEnd = alt(
  blanklines,
  whenEnabled('backtick_code_blocks', lookAhead(codeBlockFenced)),
  whenEnabled('lists_without_preceding_blankline', notAhead(listStartInItem)),
  (ctx) => (inDiv(ctx) ? divCloserAhead(ctx) : FAIL),
);
const paragraphBreak = attempt((ctx) =>
  newline(ctx) === FAIL ? FAIL : paragraphEnd(ctx),
);

/**
 * Inlines a blank line ends: a paragraph; ended otherwise, a plain block.
 *
 * Not ported yet: an image alone, read as an implicit figure.
 *
 * @see Text.Pandoc.Readers.Markdown.para
 */
export const para = attempt((ctx) => {
  const start = ctx.pos;
  const read = inlines1(ctx);
  if (read === FAIL) return FAIL;
  const ils = B.trimInlines(read);
  const end = blockEnd(ctx.text, start, ctx.pos, ils);
  const build = paragraphBreak(ctx) === FAIL ? B.plain : B.para;
  return build(ils, start, end);
});

/**
 * Inlines as a plain block.
 *
 * @see Text.Pandoc.Readers.Markdown.plain
 */
export const plain = (ctx) => {
  const start = ctx.pos;
  const read = inlines1(ctx);
  if (read === FAIL) return FAIL;
  const ils = B.trimInlines(read);
  return B.plain(ils, start, blockEnd(ctx.text, start, ctx.pos, ils));
};

/**
 * One block, by the first of Pandoc's block parsers to read one.
 *
 * @see Text.Pandoc.Readers.Markdown.block
 * @param {import('../core.js').Context} ctx
 */
export function block(ctx) {
  // Built on first call: some of these come from modules that import this
  // one, and may not exist yet when it loads.
  blockChoice ??= choice([
    blank,
    codeBlockFenced,
    // yamlMetaBlock',
    bulletList,
    // divHtml,
    divFenced,
    header,
    // lhsCodeBlock, htmlBlock, table,
    codeBlockIndented,
    // rawTeXBlock, lineBlock,
    blockQuote,
    hrule,
    orderedList,
    definitionList,
    // noteBlock, referenceKey, abbrevKey,
    para,
    plain,
  ]);
  return blockChoice(ctx);
}

/** @type {import('../core.js').Parser<unknown> | undefined} */
let blockChoice;

const blocks = manyTill(block, eof);

/**
 * Blocks to the end of the input.
 *
 * @see Text.Pandoc.Readers.Markdown.parseBlocks
 */
export const parseBlocks = (ctx) => {
  const xs = blocks(ctx);
  return xs === FAIL ? FAIL : xs.flat();
};
