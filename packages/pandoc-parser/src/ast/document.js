// A whole document, and its JSON as `pandoc -t json` writes it.

import { API_VERSION, Node } from './nodes.js';

/**
 * A document of `blocks`, with `meta` as Aeson encodes Pandoc's `Meta`: a
 * map of `MetaValue`s.
 *
 * @see Text.Pandoc.Builder.doc
 * @see Text.Pandoc.Definition.Pandoc
 * @param {Node[]} blocks
 * @param {Record<string, unknown>} [meta]
 */
export const doc = (blocks, meta = {}) => ({
  'pandoc-api-version': API_VERSION,
  meta,
  blocks,
});

/**
 * `value` as plain JSON with every node's span left out: what Pandoc's JSON
 * holds.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function withoutSpans(value) {
  return JSON.parse(
    JSON.stringify(value, function (key, v) {
      const span = (key === 'start' || key === 'end') && this instanceof Node;
      return span ? undefined : v;
    }),
  );
}
