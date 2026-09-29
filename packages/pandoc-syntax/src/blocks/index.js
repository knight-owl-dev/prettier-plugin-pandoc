// Where Pandoc's markdown blocks begin and end, by Pandoc's block rules.

import { splitLines } from '../lines.js';
import { scan } from './scan.js';

/** @typedef {import('../types.js').Block} Block */

const startOf = (block) =>
  block.type === 'div' ? block.open.start : block.start;

/**
 * Find every block Pandoc reads differently from CommonMark, the blocks it
 * reads no markdown inside, and the containers that hold them, in source
 * order.
 *
 * A div's close needs no block start: Pandoc ends the paragraph a closing fence
 * interrupts. A div never closed runs to the end of the document, as Pandoc
 * reads it (with a warning), so its `close` is null. Block quotes and list
 * items hold their content's blocks, reported beside them; every span inside a
 * container stops short of its prefix.
 *
 * @param {string} text Pandoc markdown.
 * @returns {Block[]} Offsets into `text`, a line's newline excluded.
 */
export function blocks(text) {
  /** @type {Block[]} */
  const out = [];
  scan(splitLines(text), text, out, 0);
  return out.sort((a, b) => startOf(a) - startOf(b));
}
