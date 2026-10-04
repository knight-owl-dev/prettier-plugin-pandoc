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

import { Node, Row } from '../ast/nodes.js';
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
 * @property {import('../persistent-map.js').PersistentMap<unknown>} notes
 *   Each note's contents, by its label.
 */

/**
 * What `runF` evaluates with `defaultParserState`: no references.
 *
 * @type {Tables}
 */
const EMPTY_TABLES = Object.freeze({
  keys: EMPTY_MAP,
  headerKeys: EMPTY_MAP,
  notes: EMPTY_MAP,
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
 * `p` run with no notes to resolve against, the other tables kept: a
 * note's contents, which Pandoc evaluates with an empty note table.
 *
 * @see Text.Pandoc.Readers.Markdown.note
 * @template T
 * @param {Context} ctx
 * @param {import('../core.js').Parser<T>} p
 */
export function withoutNotes(ctx, p) {
  const references = referencesOf(ctx);
  const { tables } = references;
  references.tables = tables && { ...tables, notes: EMPTY_MAP };
  try {
    return p(ctx);
  } finally {
    references.tables = tables;
  }
}

/**
 * A note whose contents the read fills once it ends: its label.
 *
 * @param {string} label
 */
export const pendingNote = (label) => Object.freeze({ pendingNote: label });

/**
 * `value` with each pending note's contents filled from `notes`.
 *
 * @param {unknown} value
 * @param {Tables['notes']} notes
 * @returns {unknown}
 */
function fillNotes(value, notes) {
  if (value instanceof Node) {
    const label = value.c?.pendingNote;
    const c =
      label === undefined ? fillNotes(value.c, notes) : notes.get(label);
    return c === value.c ? value : new Node(value.t, c, value.start, value.end);
  }
  if (value instanceof Row) {
    const cells = fillNotes(value.cells, notes);
    if (cells === value.cells) return value;
    return new Row(value.attr, cells, value.start, value.end);
  }
  if (!Array.isArray(value)) return value;
  const filled = value.map((v) => fillNotes(v, notes));
  return filled.every((v, i) => v === value[i]) ? value : filled;
}

/**
 * The value of `read`, a whole document's parse, its references resolved:
 * read again with the first read's final tables where it looked one up and
 * the document has any, its notes then filled from the second read's.
 *
 * @template T
 * @param {(references: References) => {value: T, state: Tables}} read
 * @returns {T}
 */
export function readResolved(read) {
  const first = { tables: null, lookups: 0 };
  const { value, state } = read(first);
  const { keys, headerKeys, notes } = state;
  if (first.lookups === 0 || keys.size + headerKeys.size + notes.size === 0) {
    return value;
  }
  const second = read({ tables: { keys, headerKeys, notes }, lookups: 0 });
  return /** @type {T} */ (fillNotes(second.value, second.state.notes));
}
