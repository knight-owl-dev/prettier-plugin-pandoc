// Where Pandoc's markdown blocks begin and end, by Pandoc's block rules.

import { splitLines } from '../lines.js';
import { DEFAULT_TAB_STOP, syntaxFor } from '../syntax.js';
import { REGISTRY } from './registry.js';
import { endsParagraph, scan } from './scan.js';

/** @typedef {import('../types.js').Block} Block */

// The paragraph line `interruptsParagraph` asks about when none is given.
const PARAGRAPH_LINE = 'text';

const startOf = (block) =>
  block.type === 'div' ? block.open.start : block.start;

/**
 * Find every block Pandoc reads differently from CommonMark, the blocks it
 * reads no markdown inside, and the containers that hold them, in source
 * order.
 *
 * A paragraph is reported only where Pandoc reads it past a blank line, which
 * an inline comment or tag running on keeps open. A div never closed runs to
 * the end of the document, so its `close` is null.
 * Block quotes, list items, footnote definitions and a definition list's
 * definitions hold their content's blocks, reported beside them; every span
 * inside a container stops short of its prefix.
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
 * @param {{
 *   tabStop?: number,
 *   before?: string,
 *   after?: string | (() => string),
 *   inItem?: boolean,
 * }} [options] `before` is the paragraph's line above, where a pipe table
 *   finds its header. `after` is what follows, where a fence finds its close
 *   and an environment its end; given as a function, it is asked for only
 *   where it could decide. `inItem` says the paragraph is in a list item's
 *   content, where a list may open straight after it.
 * @returns {boolean}
 */
export function interruptsParagraph(
  line,
  {
    tabStop = DEFAULT_TAB_STOP,
    before = PARAGRAPH_LINE,
    after = '',
    inItem = false,
  } = {},
) {
  const syntax = syntaxFor(tabStop);
  const above = before.replaceAll('\n', ' ');
  const endsWith = (following) => {
    const text = `${above}\n${line}\n${following}`;
    return endsParagraph(splitLines(text), text, syntax, inItem);
  };
  // What follows is read only where it could decide: a formatter asks this of
  // every word, and most open nothing.
  if (endsWith('')) return true;
  if (!REGISTRY.some((r) => r.opensAhead?.(line, syntax))) return false;
  return endsWith(typeof after === 'function' ? after() : after);
}
