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
import { enabled, whenEnabled } from '../parsing/state.js';
import { blockQuote } from './blockquote.js';
import { codeBlockFenced, codeBlockIndented } from './code.js';
import { definitionList } from './definition-lists.js';
import { divFenced, divFenceEnd, inDiv } from './divs.js';
import { header } from './headers.js';
import { hrule } from './hrule.js';
import { inlines1 } from './inlines.js';
import { lineBlock } from './line-blocks.js';
import { implicitFigure, referenceKey } from './links.js';
import { bulletList, listStartInItem, orderedList } from './lists.js';
import { noteBlock } from './notes.js';
import { divHtml, htmlBlock, htmlDivCloserAhead } from './raw-html.js';
import { rawTeXBlock } from './raw-tex.js';
import { table } from './tables.js';

const divCloserAhead = lookAhead(divFenceEnd);

// Blank lines, which make no block.
const blank = (ctx) => (blanklines(ctx) === FAIL ? FAIL : []);

// A paragraph's end after its last line: a newline, then blank lines, a
// fence, with `lists_without_preceding_blankline` anything but a list start
// in a list item, or an open `<div>`'s or fenced div's closer. Not ported
// yet, each needing a non-default extension: a block quote, an ATX heading.
const paragraphEnd = alt(
  blanklines,
  whenEnabled('backtick_code_blocks', lookAhead(codeBlockFenced)),
  whenEnabled('lists_without_preceding_blankline', notAhead(listStartInItem)),
  (ctx) => htmlDivCloserAhead(ctx),
  (ctx) => (inDiv(ctx) ? divCloserAhead(ctx) : FAIL),
);
const paragraphBreak = attempt((ctx) =>
  newline(ctx) === FAIL ? FAIL : paragraphEnd(ctx),
);

/**
 * Inlines a blank line ends: a paragraph; ended otherwise, a plain block.
 * With `implicit_figures`, an image alone with a description is a figure
 * either way.
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
  const [only] = ils;
  const isFigure =
    ils.length === 1 &&
    only.t === 'Image' &&
    only.c[1].length > 0 &&
    enabled(ctx, 'implicit_figures');
  return isFigure ? implicitFigure(only, start, end) : build(ils, start, end);
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
    divHtml,
    divFenced,
    header,
    // lhsCodeBlock,
    htmlBlock,
    table,
    codeBlockIndented,
    rawTeXBlock,
    lineBlock,
    blockQuote,
    hrule,
    orderedList,
    definitionList,
    noteBlock,
    referenceKey,
    // abbrevKey,
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
