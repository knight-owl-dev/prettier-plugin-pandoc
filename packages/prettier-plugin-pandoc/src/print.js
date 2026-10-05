// Printing: each top-level block as written, one blank line between blocks.
// Source between blocks that is no node — reference and note definitions,
// metadata — prints as written, its blank lines at either end dropped.

import { doc } from 'prettier';
import { heldBlocks } from './check.js';

const { literalline } = doc.builders;
const { replaceEndOfLine } = doc.utils;

const isBlank = (line) => /^[ \t]*$/.test(line);

/**
 * The source between two blocks, spaced: `first` before the first block,
 * `last` after the last. On the line a block ends, only what follows it
 * stays; on the line one starts, what precedes it.
 *
 * @param {string} gap
 * @param {boolean} first
 * @param {boolean} last
 */
function spaced(gap, first, last) {
  // Blocks on one line stay on it.
  if (!first && !last && !gap.includes('\n')) return gap;
  const lines = gap.split('\n');
  const head = first ? '' : lines.shift();
  const tail = last ? '' : lines.pop();
  while (lines.length > 0 && isBlank(lines[0])) lines.shift();
  while (lines.length > 0 && isBlank(lines.at(-1))) lines.pop();
  const body = lines.join('\n');
  if (first)
    return (body === '' ? '' : `${body}${last ? '\n' : '\n\n'}`) + tail;
  const ended = `${isBlank(head) ? '' : head}\n`;
  if (last) return body === '' ? ended : `${ended}\n${body}\n`;
  return body === '' ? `${ended}\n${tail}` : `${ended}\n${body}\n\n${tail}`;
}

/**
 * The document printed, the gaps next to a held block as written.
 *
 * @param {{start: number, end: number}[]} blocks
 * @param {string} text
 * @param {Set<number>} held
 */
function render(blocks, text, held) {
  // A block that reads to the end of its lines, a raw one's, spans the
  // newline after them: it spaces as the gap's.
  const ends = blocks.map(({ start, end }) => {
    while (end > start && text[end - 1] === '\n') end--;
    return end;
  });
  let out = '';
  for (let k = 0; k <= blocks.length; k++) {
    const from = k === 0 ? 0 : ends[k - 1];
    const to = k === blocks.length ? text.length : blocks[k].start;
    const gap = text.slice(from, to);
    out +=
      held.has(k - 1) || held.has(k)
        ? gap
        : spaced(gap, k === 0, k === blocks.length);
    if (k < blocks.length) out += text.slice(blocks[k].start, ends[k]);
  }
  return out;
}

// Spans Pandoc's order of blocks follows, each after the last.
const inOrder = (blocks) =>
  blocks.every(
    (b, k) =>
      Number.isInteger(b.start) &&
      Number.isInteger(b.end) &&
      b.start <= b.end &&
      (k === 0 || blocks[k - 1].end <= b.start),
  );

/**
 * @param {import('prettier').AstPath} path
 * @param {{originalText: string, pandocTabStop: number}} options
 */
export function print(path, options) {
  const { node } = path;
  const text = options.originalText;
  const out = inOrder(node.blocks)
    ? heldBlocks(node, options, (held) => render(node.blocks, text, held))
    : text;
  return replaceEndOfLine(out, literalline);
}
