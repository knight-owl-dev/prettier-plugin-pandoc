// Pandoc's markdown reader: the source to Pandoc's AST, each block and
// inline with the span of the source it was read from.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown.readMarkdown`,
// reading what Pandoc's CLI hands it: `input.js`.

import { doc } from '../ast/document.js';
import { mapSpans } from '../ast/spans.js';
import { FAIL, optional } from '../core.js';
import { readerInput } from '../input.js';
import { readerOptions } from '../options.js';
import { defaultParserState } from '../parsing/state.js';
import { parseBlocks } from './blocks.js';
import { endline, inline } from './inlines.js';
import { titleBlock } from './metadata.js';
import { readResolved } from './references.js';

/**
 * Read `source` as Pandoc's markdown.
 *
 * @see Text.Pandoc.Readers.Markdown.readMarkdown
 * @see Text.Pandoc.Readers.Markdown.parseMarkdown
 * @param {string} source
 * @param {{tabStop?: number}} [options]
 */
export function readMarkdown(source, options) {
  const opts = readerOptions(options);
  const { text, toSource, input } = readerInput(source, opts.tabStop);
  const [blocks, meta] = readResolved((references) => {
    const ctx = { text, pos: 0, state: defaultParserState(opts), references };
    optional(titleBlock)(ctx);
    const value = parseBlocks(ctx);
    if (value === FAIL) throw new Error('the markdown reader failed');
    return { value: [value, ctx.state.meta], state: ctx.state };
  });
  return doc(
    mapSpans(blocks, toSource, toSource, input),
    mapSpans(meta, toSource, toSource, input),
  );
}

/**
 * Whether a paragraph at the top level goes on past the end of a line
 * when `next` follows it: Pandoc's `endline` there, and an inline after
 * it — a block's closing tag or raw TeX is none.
 *
 * @see Text.Pandoc.Readers.Markdown.endline
 * @see Text.Pandoc.Readers.Markdown.inlines1
 * @param {string} next
 * @param {{tabStop?: number}} [options]
 */
export function continuesParagraph(next, options) {
  const opts = readerOptions(options);
  const { text } = readerInput(`\n${next}`, opts.tabStop);
  const ctx = { text, pos: 0, state: defaultParserState(opts) };
  if (endline(ctx) === FAIL) return false;
  return ctx.pos === text.length || inline(ctx) !== FAIL;
}
