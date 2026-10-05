// Note definitions: no block of the AST, so text between blocks to the
// printer, but each note referring to one holds its contents, which locate
// it and print it.

import { contentsView, lineStart, prefixed, printIn } from './blocks.js';

/** @typedef {import('./wrap.js').Context} Context */

/**
 * @typedef {object} Definition
 * @property {number} start Where its marker line starts in the source.
 * @property {number} end Where its contents end.
 * @property {string} marker `[^label]:`, as written.
 * @property {object[]} blocks Its blocks, carrying their `contents`.
 */

const MARKER = /^ {0,3}\[\^[^\]\s]+\]:$/;

// Each Note under `value` whose blocks carry their contents: a definition's,
// where an inline note's carry none.
function notesIn(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) notesIn(v, out);
  } else if (value !== null && typeof value === 'object') {
    if (value.t === 'Note' && value.c.contents !== undefined) out.push(value);
    for (const v of Object.values(value)) notesIn(v, out);
  }
  return out;
}

/**
 * The definitions of the notes `blocks` refer to, in source order, each
 * once. One whose contents start on a line of their own is left out: it
 * prints as written.
 *
 * @param {object[]} blocks
 * @param {string} text The source.
 * @returns {Definition[]}
 */
export function definitionsOf(blocks, text) {
  const found = new Map();
  for (const note of notesIn(blocks)) {
    const { contents } = note.c;
    const first = contents.pieces[0];
    if (first === undefined || note.c.length === 0) continue;
    const start = lineStart(text, first.from);
    const marker = text.slice(start, first.from);
    if (!MARKER.test(marker) || /^[ \t]*\n/.test(contents.text)) continue;
    // Where its contents end, past text no block of it spans.
    const end = contents.toOuterEnd(contents.text.trimEnd().length);
    if (note.c.some((b) => b.end > end)) continue;
    found.set(start, { start, end, marker, blocks: note.c });
  }
  return [...found.values()].sort((a, b) => a.start - b.start);
}

/**
 * A definition printed: its marker as written, its first block on that
 * line, every other line indented one tab stop, as far as Pandoc strips.
 * Null where it prints as written.
 *
 * @param {Definition} definition
 * @param {Context} context
 * @param {{pandocTabStop: number}} options
 * @returns {string | null}
 */
export function printDefinition(definition, context, options) {
  const { blocks, marker } = definition;
  const inner = contentsView(blocks.contents);
  const indent = options.pandocTabStop;
  // The first line's text follows the marker and a space.
  const within = {
    ...context,
    width: context.width - indent,
    column: Math.max(0, marker.length + 1 - indent),
  };
  const body = printIn(blocks, inner, 0, inner.text.length, within, options);
  if (body === null) return null;
  const rest = ' '.repeat(indent);
  const [head, ...tail] = body.split('\n');
  const first = /^\s/.test(head) ? head : ` ${head}`;
  const opening = marker + first;
  if (tail.length === 0) return opening;
  return `${opening}\n${prefixed(tail.join('\n'), rest, rest)}`;
}
