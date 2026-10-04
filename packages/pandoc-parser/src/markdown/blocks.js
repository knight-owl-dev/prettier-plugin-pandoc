// The markdown reader's block parsers: each returns its blocks, every node
// spanning what it read.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. A parser not
// ported yet keeps its place in `block`'s choice as a comment.

import * as B from '../ast/builder.js';
import { newline } from '../char.js';
import { attempt, choice, eof, FAIL, manyTill } from '../core.js';
import { blanklines } from '../parsing/general.js';
import { inlines1 } from './inlines.js';

// Blank lines, which make no block.
const blank = (ctx) => (blanklines(ctx) === FAIL ? FAIL : []);

// A paragraph's end after its last line: a newline, then blank lines. Not
// ported yet, each needing a construct or a non-default extension: a block
// quote, a backtick fence, an ATX heading, a list start, the closer of an
// open HTML block or div.
const paragraphBreak = attempt((ctx) =>
  newline(ctx) === FAIL ? FAIL : blanklines(ctx),
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
  const ils = inlines1(ctx);
  if (ils === FAIL) return FAIL;
  const end = ctx.pos;
  const build = paragraphBreak(ctx) === FAIL ? B.plain : B.para;
  return build(B.trimInlines(ils), start, end);
});

/**
 * Inlines as a plain block.
 *
 * @see Text.Pandoc.Readers.Markdown.plain
 */
export const plain = (ctx) => {
  const start = ctx.pos;
  const ils = inlines1(ctx);
  return ils === FAIL ? FAIL : B.plain(B.trimInlines(ils), start, ctx.pos);
};

/**
 * One block, by the first of Pandoc's block parsers to read one.
 *
 * @see Text.Pandoc.Readers.Markdown.block
 */
export const block = choice([
  blank,
  // codeBlockFenced, yamlMetaBlock', bulletList, divHtml, divFenced,
  // header, lhsCodeBlock, htmlBlock, table, codeBlockIndented, rawTeXBlock,
  // lineBlock, blockQuote, hrule, orderedList, definitionList, noteBlock,
  // referenceKey, abbrevKey,
  para,
  plain,
]);

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
