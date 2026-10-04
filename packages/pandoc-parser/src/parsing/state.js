// Pandoc's parser state, the fields the port reads so far, and the parsers
// that read and write them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.State` and
// `Text.Pandoc.Parsing.Capabilities`. The state is never mutated: a write
// replaces it, so a choice point restores it by reference.

import { FAIL } from '../core.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../options.js').ReaderOptions} ReaderOptions */

/**
 * @typedef {object} ParserState
 * @property {ReaderOptions} options
 * @property {'NullState' | 'ListItemState'} parserContext
 * @property {'NoQuote' | 'InSingleQuote' | 'InDoubleQuote'} quoteContext
 * @property {boolean} allowLineBreaks
 * @property {number | null} lastStrPos Where the last `str` ended.
 */

/**
 * The state a parse starts in.
 *
 * @see Text.Pandoc.Parsing.State.defaultParserState
 * @param {ReaderOptions} options
 * @returns {ParserState}
 */
export const defaultParserState = (options) => ({
  options,
  parserContext: 'NullState',
  quoteContext: 'NoQuote',
  allowLineBreaks: true,
  lastStrPos: null,
});

/**
 * Replace the state with `fields` changed.
 *
 * @see Text.Parsec.Prim.updateState
 * @param {Context} ctx
 * @param {Partial<ParserState>} fields
 */
export function updateState(ctx, fields) {
  ctx.state = { ...ctx.state, ...fields };
}

/**
 * Whether extension `name` is on.
 *
 * @see Text.Pandoc.Options.extensionEnabled
 * @param {Context} ctx
 * @param {string} name
 */
export const enabled = (ctx, name) => ctx.state.options.extensions.has(name);

/**
 * Succeed, reading nothing, where extension `name` is on.
 *
 * @see Text.Pandoc.Parsing.Capabilities.guardEnabled
 * @param {string} name
 */
export const guardEnabled = (name) => (ctx) =>
  enabled(ctx, name) ? undefined : FAIL;

/**
 * Succeed, reading nothing, where extension `name` is off.
 *
 * @see Text.Pandoc.Parsing.Capabilities.guardDisabled
 * @param {string} name
 */
export const guardDisabled = (name) => (ctx) =>
  enabled(ctx, name) ? FAIL : undefined;

/**
 * Record that a `str` ends here.
 *
 * @see Text.Pandoc.Parsing.Capabilities.updateLastStrPos
 * @param {Context} ctx
 */
export const updateLastStrPos = (ctx) =>
  updateState(ctx, { lastStrPos: ctx.pos });

/**
 * Whether the position is not right after a `str`.
 *
 * @see Text.Pandoc.Parsing.Capabilities.notAfterString
 * @param {Context} ctx
 */
export const notAfterString = (ctx) => ctx.state.lastStrPos !== ctx.pos;

/**
 * `p` in quote context `context`, the old context put back after it.
 *
 * @see Text.Pandoc.Parsing.Capabilities.withQuoteContext
 * @template T
 * @param {ParserState['quoteContext']} context
 * @param {import('../core.js').Parser<T>} p
 */
export const withQuoteContext = (context, p) => (ctx) => {
  const outer = ctx.state.quoteContext;
  updateState(ctx, { quoteContext: context });
  const x = p(ctx);
  if (x !== FAIL) updateState(ctx, { quoteContext: outer });
  return x;
};

/**
 * Fail where already in quote context `context`.
 *
 * @see Text.Pandoc.Parsing.Capabilities.failIfInQuoteContext
 * @param {ParserState['quoteContext']} context
 */
export const failIfInQuoteContext = (context) => (ctx) =>
  ctx.state.quoteContext === context ? FAIL : undefined;
