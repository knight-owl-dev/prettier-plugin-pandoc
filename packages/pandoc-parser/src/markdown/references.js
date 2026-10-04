// What Pandoc's reader defers until its parse ends: a reference's target,
// looked up in tables the whole document fills. Pandoc builds `F` values,
// evaluated against the final state; the port reads the document again
// instead, the second time with the first read's final tables, where the
// first looked anything up. Every parse decision is Pandoc's either way:
// none waits on a lookup.
//
// The tables and the record of lookups ride on the context, not in the
// parser state, which backtracking and Pandoc's own `setState`s put back:
// a lookup in a link's text, whose state `link` drops, still happened.

import { EMPTY_MAP } from '../persistent-map.js';

/** @typedef {import('../core.js').Context} Context */

/**
 * The tables references resolve against.
 *
 * @typedef {object} Tables
 * @property {import('../persistent-map.js').PersistentMap<unknown>} keys
 *   Each reference key's target and attributes.
 * @property {import('../persistent-map.js').PersistentMap<unknown>} headerKeys
 *   Each heading's implicit reference key, its target and attributes.
 */

/**
 * What `runF` evaluates with `defaultParserState`: no references.
 *
 * @type {Tables}
 */
const EMPTY_TABLES = Object.freeze({
  keys: EMPTY_MAP,
  headerKeys: EMPTY_MAP,
});

/**
 * A reader context's references: the tables of the read before, none in
 * the first, and how many lookups this read made.
 *
 * @typedef {{tables: Tables | null, lookups: number}} References
 */

/**
 * @param {Context & {references?: References}} ctx
 * @returns {References}
 */
const referencesOf = (ctx) => (ctx.references ??= { tables: null, lookups: 0 });

/**
 * The tables to resolve a reference against, the lookup recorded: the
 * final ones of the read before, or none in the first read.
 *
 * @see Text.Pandoc.Parsing.Future.asksF
 * @param {Context} ctx
 * @returns {Tables}
 */
export function lookupTables(ctx) {
  const references = referencesOf(ctx);
  references.lookups++;
  return references.tables ?? EMPTY_TABLES;
}

/**
 * How many lookups this read has made.
 *
 * @param {Context} ctx
 */
export const lookupCount = (ctx) => referencesOf(ctx).lookups;

/**
 * `p` run with no tables to resolve against: what `runF` with
 * `defaultParserState` evaluates.
 *
 * @see Text.Pandoc.Parsing.Future.runF
 * @template T
 * @param {Context} ctx
 * @param {import('../core.js').Parser<T>} p
 */
export function withoutTables(ctx, p) {
  const references = referencesOf(ctx);
  const { tables } = references;
  references.tables = null;
  try {
    return p(ctx);
  } finally {
    references.tables = tables;
  }
}

/**
 * The value of `read`, a whole document's parse, its references resolved:
 * read again with the first read's final tables where it looked one up and
 * the document has any.
 *
 * @template T
 * @param {(references: References) => {value: T, state: {keys: Tables['keys'], headerKeys: Tables['headerKeys']}}} read
 * @returns {T}
 */
export function readResolved(read) {
  const first = { tables: null, lookups: 0 };
  const { value, state } = read(first);
  const { keys, headerKeys } = state;
  if (first.lookups === 0 || keys.size + headerKeys.size === 0) return value;
  return read({ tables: { keys, headerKeys }, lookups: 0 }).value;
}
