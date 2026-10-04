// Pandoc's markdown reader: the source to Pandoc's AST, each block and
// inline with the span of the source it was read from.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown.readMarkdown`,
// reading what Pandoc's CLI hands it: `input.js`.

import { doc } from '../ast/document.js';
import { mapSpans } from '../ast/spans.js';
import { FAIL } from '../core.js';
import { readerInput } from '../input.js';
import { readerOptions } from '../options.js';
import { defaultParserState } from '../parsing/state.js';
import { parseBlocks } from './blocks.js';
import { readResolved } from './references.js';

/**
 * Read `source` as Pandoc's markdown.
 *
 * Not ported yet: a title block, and metadata.
 *
 * @see Text.Pandoc.Readers.Markdown.readMarkdown
 * @see Text.Pandoc.Readers.Markdown.parseMarkdown
 * @param {string} source
 * @param {{tabStop?: number}} [options]
 */
export function readMarkdown(source, options) {
  const opts = readerOptions(options);
  const { text, toSource } = readerInput(source, opts.tabStop);
  const blocks = readResolved((references) => {
    const ctx = { text, pos: 0, state: defaultParserState(opts), references };
    const value = parseBlocks(ctx);
    if (value === FAIL) throw new Error('the markdown reader failed');
    return { value, state: ctx.state };
  });
  return doc(mapSpans(blocks, toSource, toSource));
}
