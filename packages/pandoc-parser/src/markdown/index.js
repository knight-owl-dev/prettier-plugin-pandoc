// Pandoc's markdown reader: the source to Pandoc's AST, each block and
// inline with the span of the source it was read from.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown.readMarkdown`,
// reading what Pandoc's CLI hands it: `input.js`.

import { doc } from '../ast/document.js';
import { Node } from '../ast/nodes.js';
import { FAIL, parse } from '../core.js';
import { readerInput } from '../input.js';
import { readerOptions } from '../options.js';
import { defaultParserState } from '../parsing/state.js';
import { parseBlocks } from './blocks.js';

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
  const { value } = parse(parseBlocks, text, defaultParserState(opts));
  if (value === FAIL) throw new Error('the markdown reader failed');
  return doc(toSourceSpans(value, toSource));
}

// `value` rebuilt with each node's span an offset into the source, not into
// the text read: built values are never mutated. Frozen ones hold no nodes.
function toSourceSpans(value, toSource) {
  if (value instanceof Node) {
    const c = toSourceSpans(value.c, toSource);
    return new Node(value.t, c, toSource(value.start), toSource(value.end));
  }
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => toSourceSpans(v, toSource));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, toSourceSpans(v, toSource)]),
  );
}
