// Definitions, notes' and references': no block of the AST, so text between
// blocks to the printer, spliced in printed wherever they stand, at the top
// level or in a container's contents.

import { definitionsOf, printDefinition } from './notes.js';
import { printReference } from './references.js';

/** @typedef {import('./wrap.js').View} View */
/** @typedef {import('./wrap.js').Context} Context */

/**
 * A definition: where it is in the source, and its printer, null where it
 * prints as written.
 *
 * @typedef {object} Definition
 * @property {number} start
 * @property {number} end
 * @property {(context: Context, options: object) => string | null} print
 */

/**
 * The notes' and references' definitions in `root`, in source order.
 *
 * @param {{blocks: object[], definitions?: object[]}} root
 * @param {string} text The source.
 * @returns {Definition[]}
 */
export function definitionsIn(root, text) {
  const notes = definitionsOf(root.blocks, text).map((note) => ({
    start: note.start,
    end: note.end,
    print: (context, options) => printDefinition(note, context, options),
  }));
  const references = (root.definitions ?? []).map((reference) => ({
    start: reference.start,
    end: reference.end,
    print: () => printReference(reference, text),
  }));
  return [...notes, ...references].sort((a, b) => a.start - b.start);
}

/**
 * `view`'s text from `from` to `to`, each definition inside it printed:
 * `options.pandocDefinitions`, none while the self-check holds a block.
 *
 * @param {View} view
 * @param {number} from
 * @param {number} to
 * @param {Context} context
 * @param {{pandocDefinitions?: Definition[]}} options
 */
export function withDefinitions(view, from, to, context, options) {
  const { text } = view;
  let out = '';
  let at = from;
  for (const definition of options.pandocDefinitions ?? []) {
    if (!view.contains(definition.start)) continue;
    const start = view.start(definition.start);
    const end = view.end(definition.end);
    if (start < at || end > to || start >= end) continue;
    const printed = definition.print(context, options);
    if (printed === null) continue;
    out += text.slice(at, start) + printed;
    at = end;
  }
  return out + text.slice(at, to);
}
