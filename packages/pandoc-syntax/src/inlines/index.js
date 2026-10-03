// Where Pandoc's inline raw TeX and math are, in the text Pandoc reads as
// markdown.
//
// Pandoc keeps a TeX command and its arguments raw: `\footnote{see *this*}` is
// one raw span, the emphasis inside it included. A formula keeps its text,
// line breaks and spaces with it. Every raw inline and formula Pandoc finds
// lies inside one span here, so a caller that leaves the spans as written
// leaves Pandoc's text alone.

import { blocks } from '../blocks/index.js';
import { commandEnd, startsCommand } from '../command.js';
import { opaqueEnd } from '../opaque.js';

/** @typedef {import('../types.js').Block} Block */
/** @typedef {import('../types.js').InlineSpan} InlineSpan */
/** @typedef {import('../types.js').Span} Span */

const MATH = '$';

// Blocks whose text Pandoc reads as markdown.
const READ = new Set([
  'block-quote',
  'list-item',
  'footnote-definition',
  'heading',
  'paragraph',
]);

/**
 * Where markdown is not read, in source order: every block but a container,
 * a heading or a div's body, whose fence lines are markup of their own.
 *
 * @param {Block[]} found
 * @returns {Span[]}
 */
function unread(found) {
  return found
    .filter((block) => !READ.has(block.type))
    .flatMap((block) =>
      block.type === 'div'
        ? [block.open, block.close].filter((span) => span !== null)
        : [block],
    )
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start);
}

const CONTAINERS = new Set([
  'block-quote',
  'list-item',
  'footnote-definition',
  'definition',
]);

const BREAK = /\n[ \t]*(?=\n|$)/g;

/**
 * How far a command's groups may run from each offset asked, asked in order:
 * past a blank line only in a paragraph `blocks` holds past one, and never
 * past the container Pandoc reads its text in, as a document of its own.
 *
 * @param {Block[]} found
 * @param {string} text
 */
function boundsOf(found, text) {
  const byStart = (type) =>
    found.filter((block) => type(block.type)).sort((a, b) => a.start - b.start);
  const containers = byStart((type) => CONTAINERS.has(type));
  const held = byStart((type) => type === 'paragraph');
  const breaks = [...text.matchAll(BREAK)].map((m) => m.index);
  const open = [];
  let [c, h, b] = [0, 0, 0];
  return (/** @type {number} */ at) => {
    while (c < containers.length && containers[c].start <= at) {
      open.push(containers[c++]);
    }
    while (open.length > 0 && open.at(-1).end <= at) open.pop();
    while (h < held.length && held[h].end <= at) h++;
    while (b < breaks.length && breaks[b] < at) b++;
    const paragraph =
      held[h] !== undefined && held[h].start <= at
        ? held[h].end
        : (breaks[b] ?? text.length);
    return Math.min(open.at(-1)?.end ?? text.length, paragraph);
  };
}

/**
 * Find every inline raw TeX and math span, in source order.
 *
 * @param {string} text Pandoc markdown.
 * @param {Block[]} [found] What `blocks` found in `text`, for a caller that
 *   already has it.
 * @returns {InlineSpan[]} Offsets into `text`.
 */
export function inlines(text, found = blocks(text)) {
  /** @type {InlineSpan[]} */
  const spans = [];
  const skipped = unread(found);
  const boundOf = boundsOf(found, text);
  let next = 0;

  for (let i = 0; i < text.length; ) {
    while (next < skipped.length && skipped[next].end <= i) next++;
    if (next < skipped.length && skipped[next].start <= i) {
      i = skipped[next].end;
      continue;
    }
    const past = opaqueEnd(text, i);
    if (past > i) {
      if (text[i] === MATH) spans.push({ type: 'math', start: i, end: past });
      i = past;
      continue;
    }
    if (!startsCommand(text, i)) {
      // A backslash before anything but a letter escapes the character.
      i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    const end = commandEnd(text, i, boundOf(i));
    if (end === null) {
      i += 2;
      continue;
    }
    spans.push({ type: 'raw-tex', start: i, end });
    i = end;
  }
  return spans;
}
