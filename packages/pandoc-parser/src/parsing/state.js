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
 * @property {PersistentMap<unknown[]>} notes Each note's contents, by its
 *   label.
 * @property {number} noteNumber How many note references and inline notes
 *   were read: a citation's note number.
 * @property {string | null} inHtmlBlock The tag of the HTML block being
 *   read, whose closing tag ends what is inside it.
 * @property {boolean} inNote Whether a note's contents are being read,
 *   whose citations take its reference's number.
 * @property {number} nextExample The next example list item's number.
 * @property {PersistentMap<number>} examples Each example label's number.
 * @property {number} fencedDivLevel How many fenced divs are open.
 * @property {Definitions | null} definitions The reference definitions read
 *   so far, the last first: where each part is, for a consumer to print or
 *   check.
 * @property {Held<{key: string, start: number, end: number}> | null}
 *   noteDefinitions Each note definition read: its label and span.
 * @property {PersistentMap<boolean>} noteRefs The note labels referred to.
 * @property {Held<import('../logging.js').LogMessage> | null} logMessages
 *   Messages held to report once reading ends.
 * @property {Held<object> | null} unresolved Each reference looked up and
 *   not found: `references.js` unresolved.
 * @property {Held<{kind: 'yaml' | 'title', start: number, end: number}> | null}
 *   metadataBlocks Each metadata block read: its kind and span.
 * @property {Map<string, import('../latex/parsing.js').Macro>} macros The
 *   TeX macros defined so far.
 * @property {Record<string, unknown>} meta The document's metadata so far.
 */

/** @typedef {[string, string[], [string, string][]]} Attr */

/**
 * A reference definition's spans: the whole, from its label's bracket to
 * its last part, and each part; a title or attributes it lacks null.
 *
 * @typedef {object} Definition
 * @property {number} start
 * @property {number} end
 * @property {[number, number]} label `[label]:`, its colon included.
 * @property {[number, number]} url
 * @property {[number, number] | null} title With its quotes.
 * @property {[number, number] | null} attributes With their braces.
 */

/**
 * A list held in the parser's state, the last first.
 *
 * @template T
 * @typedef {{item: T, next: Held<T> | null}} Held
 */
/** @typedef {Held<Definition>} Definitions */

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
  notes: EMPTY_MAP,
  noteNumber: 0,
  inNote: false,
  macros: new Map(),
  meta: {},
  inHtmlBlock: null,
  nextExample: 1,
  examples: EMPTY_MAP,
  fencedDivLevel: 0,
  definitions: null,
  noteDefinitions: null,
  noteRefs: EMPTY_MAP,
  logMessages: null,
  unresolved: null,
  metadataBlocks: null,
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
// positions of each text it reads, kept across a re-read that swaps its
// text and back: weakly held, so none outlives what it belongs to.
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

/**
 * The line and column a parse is at, as Pandoc's input counts them.
 *
 * @see Text.Parsec.Prim.getPosition
 * @param {Context} ctx
 * @param {number} [offset] Another offset in the text it reads.
 * @returns {{line: number, column: number}}
 */
export const getPosition = (ctx, offset = ctx.pos) =>
  placeHere({ ...ctx, pos: offset }, ctx);

function placeHere(ctx, key = ctx) {
  let texts = reading.get(key);
  if (texts === undefined) {
    texts = new Map();
    reading.set(key, texts);
  }
  let found = texts.get(ctx.text);
  if (found === undefined) {
    found = positions(ctx.text);
    texts.set(ctx.text, found);
  }
  return found.locate(ctx.pos);
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
