// Where Pandoc's markdown blocks begin and end, by Pandoc's block rules.

import { splitLines } from '../lines.js';
import { DEFAULT_TAB_STOP, syntaxFor } from '../syntax.js';
import { endsParagraph, scan } from './scan.js';

/** @typedef {import('../types.js').Block} Block */

// The paragraph `interruptsParagraph` asks about.
const PARAGRAPH_LINE = 'text';

const startOf = (block) =>
  block.type === 'div' ? block.open.start : block.start;

/**
 * Find every block Pandoc reads differently from CommonMark, the blocks it
 * reads no markdown inside, and the containers that hold them, in source
 * order.
 *
 * A div never closed runs to the end of the document, so its `close` is null.
 * Block quotes, list items and footnote definitions hold their content's
 * blocks, reported beside them; every span inside a container stops short of
 * its prefix.
 *
 * @param {string} text Pandoc markdown.
 * @param {{tabStop?: number}} [options] `tabStop` is Pandoc's `--tab-stop`,
 *   which decides every indentation rule.
 * @returns {Block[]} Offsets into `text`, a line's newline excluded.
 */
export function blocks(text, { tabStop = DEFAULT_TAB_STOP } = {}) {
  /** @type {Block[]} */
  const out = [];
  scan(splitLines(text), text, out, 0, syntaxFor(tabStop));
  return out.sort((a, b) => startOf(a) - startOf(b));
}

/**
 * Whether `line`, as the second line of a paragraph, would end it instead: a
 * line a formatter must not wrap a paragraph onto.
 *
 * @param {string} line One line, without its newline.
 * @param {{tabStop?: number, after?: string}} [options] `after` is what
 *   follows the line, where a fence finds its close and an environment its
 *   end.
 * @returns {boolean}
 */
export function interruptsParagraph(
  line,
  { tabStop = DEFAULT_TAB_STOP, after = '' } = {},
) {
  const text = `${PARAGRAPH_LINE}\n${line}\n${after}`;
  return endsParagraph(splitLines(text), text, syntaxFor(tabStop));
}
