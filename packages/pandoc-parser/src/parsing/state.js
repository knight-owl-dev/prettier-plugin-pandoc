// Pandoc's parser state, the fields the port reads so far, and the parsers
// that read and write them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.State` and
// `Text.Pandoc.Parsing.Capabilities`. The state is never mutated: a write
// replaces it, so a choice point restores it by reference.

import { FAIL } from '../core.js';
import { EMPTY_MAP } from '../persistent-map.js';
import { positions } from '../position.js';
import { toLower, words } from '../shared.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../options.js').ReaderOptions} ReaderOptions */

/**
 * @typedef {object} ParserState
 * @property {ReaderOptions} options
 * @property {'NullState' | 'ListItemState'} parserContext
 * @property {'NoQuote' | 'InSingleQuote' | 'InDoubleQuote'} quoteContext
 * @property {boolean} allowLineBreaks
 * @property {boolean} allowLinks Whether a link may open: not in a link's
 *   text.
 * @property {StrEnd | null} lastStrPos Where the last `str` ended.
 * @property {PersistentMap<true>} identifiers Header identifiers used.
 * @property {PersistentMap<[[string, string], Attr]>} keys Each reference
 *   key's target and attributes.
 * @property {PersistentMap<[[string, string], Attr]>} headerKeys Each
 *   header's reference key: its target and attributes.
 * @property {number} nextExample The next example list item's number.
 * @property {PersistentMap<number>} examples Each example label's number.
 * @property {number} fencedDivLevel How many fenced divs are open.
 */

/** @typedef {[string, string[], [string, string][]]} Attr */

/**
 * A place in text read: its depth in text parsed again, the text, and an
 * offset into it.
 *
 * @typedef {{depth: number, text: string, offset: number}} StrEnd
 */
/** @template V @typedef {import('../persistent-map.js').PersistentMap<V>} PersistentMap */

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
  allowLinks: true,
  lastStrPos: null,
  identifiers: EMPTY_MAP,
  keys: EMPTY_MAP,
  headerKeys: EMPTY_MAP,
  nextExample: 1,
  examples: EMPTY_MAP,
  fencedDivLevel: 0,
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
 * `p` where extension `name` is on: Haskell's `guardEnabled name >> p`.
 *
 * @see Text.Pandoc.Parsing.Capabilities.guardEnabled
 * @template T
 * @param {string} name
 * @param {import('../core.js').Parser<T>} p
 * @returns {import('../core.js').Parser<T>}
 */
export const whenEnabled = (name, p) => (ctx) =>
  enabled(ctx, name) ? p(ctx) : FAIL;

/**
 * Record that a `str` ends here.
 *
 * @see Text.Pandoc.Parsing.Capabilities.updateLastStrPos
 * @param {Context} ctx
 */
export const updateLastStrPos = (ctx) =>
  updateState(ctx, {
    lastStrPos: { depth: ctx.depth ?? 0, text: ctx.text, offset: ctx.pos },
  });

/**
 * Whether the position is not right after a `str`. Positions compare as
 * Parsec's do: text parsed again at the same depth shares a source name and
 * starts at line 1, so a `str` ending in one such text can stand right
 * before a place in another, at the same line and column.
 *
 * @see Text.Pandoc.Parsing.Capabilities.notAfterString
 * @param {Context} ctx
 */
export function notAfterString(ctx) {
  const last = ctx.state.lastStrPos;
  if (last === null || last.depth !== (ctx.depth ?? 0)) return true;
  if (last.text === ctx.text) return last.offset !== ctx.pos;
  const [a, b] = [placeOf(last), placeHere(ctx)];
  return a.line !== b.line || a.column !== b.column;
}

// Each `str` end's line and column, worked out once, and each parse's
// positions of the text it reads now: weakly held, so none outlives what
// it belongs to.
const places = new WeakMap();
const reading = new WeakMap();

function placeOf(end) {
  let place = places.get(end);
  if (place === undefined) {
    place = positions(end.text).locate(end.offset);
    places.set(end, place);
  }
  return place;
}

function placeHere(ctx) {
  let now = reading.get(ctx);
  if (now?.text !== ctx.text) {
    now = { text: ctx.text, positions: positions(ctx.text) };
    reading.set(ctx, now);
  }
  return now.positions.locate(ctx.pos);
}

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

/**
 * The key a reference label is looked up by: brackets dropped, spaces
 * collapsed, lowercased.
 *
 * @see Text.Pandoc.Parsing.State.toKey
 * @param {string} label
 */
export function toKey(label) {
  const inner =
    label.startsWith('[') && label.endsWith(']') && label.length >= 2
      ? label.slice(1, -1)
      : label;
  return toLower(words(inner).join(' '));
}
