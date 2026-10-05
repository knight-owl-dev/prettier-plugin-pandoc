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
  const [blocks, meta, definitions] = readResolved((references) => {
    const ctx = { text, pos: 0, state: defaultParserState(opts), references };
    optional(titleBlock)(ctx);
    const value = parseBlocks(ctx);
    if (value === FAIL) throw new Error('the markdown reader failed');
    const read = [value, ctx.state.meta, inOrder(ctx.state.definitions)];
    return { value: read, state: ctx.state };
  });
  const result = doc(
    mapSpans(blocks, toSource, toSource, input),
    mapSpans(meta, toSource, toSource, input),
  );
  // The reference definitions read, in source order: no node, so out of
  // Pandoc's JSON.
  const span = (s) => (s === null ? null : [toSource(s[0]), toSource(s[1])]);
  const located = definitions.map((d) => ({
    start: toSource(d.start),
    end: toSource(d.end),
    label: span(d.label),
    url: span(d.url),
    title: span(d.title),
    attributes: span(d.attributes),
  }));
  Object.defineProperty(result, 'definitions', { value: located });
  return result;
}

// A list the last first, as an array in order.
function inOrder(list) {
  const out = [];
  for (let at = list; at !== null; at = at.next) out.push(at.definition);
  return out.reverse();
}

/**
 * Whether a paragraph goes on past the end of a line when `next` follows
 * it: Pandoc's `endline` there, and an inline after it — a block's closing
 * tag or raw TeX is none. `inListItem`, `divLevel` and `inHtmlBlock` give
 * the paragraph's context: in a list item, a list start ends it; in a div,
 * a closing fence; in an HTML block, the tag closing it (`div`).
 *
 * @see Text.Pandoc.Readers.Markdown.endline
 * @see Text.Pandoc.Readers.Markdown.inlines1
 * @param {string} next
 * @param {{tabStop?: number, inListItem?: boolean, divLevel?: number, inHtmlBlock?: string | null}} [options]
 */
export function continuesParagraph(next, options = {}) {
  const opts = readerOptions(options);
  const { text } = readerInput(`\n${next}`, opts.tabStop);
  const state = {
    ...defaultParserState(opts),
    parserContext: options.inListItem ? 'ListItemState' : 'NullState',
    fencedDivLevel: options.divLevel ?? 0,
    inHtmlBlock: options.inHtmlBlock ?? null,
  };
  const ctx = { text, pos: 0, state };
  if (endline(ctx) === FAIL) return false;
  return ctx.pos === text.length || inline(ctx) !== FAIL;
}
