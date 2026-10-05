// Reflow: a paragraph's words, as written, filled to the print width. A word
// stays on the line before where a line starting at it would read the
// paragraph differently: where Pandoc's `endline` would end it there, or
// where its first two lines would read as another block — a definition, a
// setext heading, a table.

import {
  continuesParagraph,
  readMarkdown,
} from '@knight-owl-dev/pandoc-parser';
import { util } from 'prettier';
import { edited, markerEdits } from './emphasis.js';

const BREAKS = new Set(['Space', 'SoftBreak', 'LineBreak']);

// The break nodes under `value`, nested ones included, each within every
// node around it: a note's contents, read from its definition elsewhere,
// hold none of the paragraph's.
function breaksIn(value, out, from = -Infinity, to = Infinity) {
  if (Array.isArray(value)) {
    for (const v of value) breaksIn(v, out, from, to);
  } else if (value !== null && typeof value === 'object') {
    const spanned =
      Number.isInteger(value.start) && Number.isInteger(value.end);
    if (spanned && (value.start < from || value.end > to)) return out;
    if (BREAKS.has(value.t)) out.push(value);
    else {
      const [inFrom, inTo] = spanned ? [value.start, value.end] : [from, to];
      for (const v of Object.values(value)) breaksIn(v, out, inFrom, inTo);
    }
  }
  return out;
}

const SPACE = /^[ \t]*\n?[ \t]*$/;
const HARD = /^([ \t]*|\\)\n[ \t]*$/;

/**
 * A view of source text: the text a container's content was read as, or
 * the source itself, and where a source offset starting or ending a node
 * falls in it.
 *
 * @typedef {object} View
 * @property {string} text
 * @property {(offset: number) => number} start
 * @property {(offset: number) => number} end
 */

/**
 * A paragraph's words as written, emphasis markers prettier's
 * (`emphasis.js`), each with the break before it: `space`, `soft` for a
 * line break, or `hard` for a hard break, which keeps what ends its line.
 * Null where its breaks are not whitespace of its own text, in order — a
 * note's from elsewhere aside.
 *
 * @param {{c: unknown, start: number, end: number}} para
 * @param {View} view
 * @returns {{word: string, before: 'space' | 'soft' | 'hard' | null}[] | null}
 */
function wordsOf(para, view) {
  const { text } = view;
  const edits = markerEdits(para.c, view).sort((a, b) => a.from - b.from);
  const slice = (from, to) => edited(text, from, to, edits);
  const [start, end] = [view.start(para.start), view.end(para.end)];
  const breaks = breaksIn(para.c, [])
    .filter((b) => b.start >= para.start && b.end <= para.end)
    .map((b) => ({ t: b.t, start: view.start(b.start), end: view.end(b.end) }))
    .sort((a, b) => a.start - b.start)
    .filter((b, k, bs) => k === 0 || bs[k - 1].start !== b.start);
  const words = [];
  let from = start;
  let before = null;
  // After a break, spaces a break's span stops short of: part of a tab.
  const wordFrom = (word) => (before === null ? word : word.trimStart());
  for (const b of breaks) {
    const gap = text.slice(b.start, b.end);
    if (b.start < from || b.end > end) return null;
    const hard = b.t === 'LineBreak';
    if (!(hard ? HARD : SPACE).test(gap)) return null;
    const kept = hard ? gap.slice(0, gap.indexOf('\n')) : '';
    words.push({ word: wordFrom(slice(from, b.start) + kept), before });
    from = b.end;
    before = hard ? 'hard' : b.t === 'SoftBreak' ? 'soft' : 'space';
  }
  // Spaces ending its line go; before a block on the same line they stay.
  const last = wordFrom(slice(from, end));
  const endsLine =
    end === text.length || text[end] === '\n' || /\n[ \t]*$/.test(last);
  const word = endsLine ? last.trimEnd() : last;
  // A hard break ending the text breaks no line after it.
  if (word !== '' || before !== 'hard') words.push({ word, before });
  return words;
}

// The width of a line's last row.
const widthOf = (line) =>
  util.getStringWidth(line.slice(line.lastIndexOf('\n') + 1));

const join = (words) => words.map(({ word }) => word).join(' ');

// The words from `at` on that fit one line, all of them that do.
function lineFrom(words, at, width) {
  let line = words[at].word;
  let k = at + 1;
  while (k < words.length && words[k].before !== 'hard') {
    const next = `${line} ${words[k].word}`;
    if (widthOf(next) > width) break;
    line = next;
    k++;
  }
  return { line, next: k };
}

// Whether `text` alone reads as one paragraph; text that fails to read
// does not.
function isPara(text, read) {
  try {
    const { blocks } = readMarkdown(text, read);
    return blocks.length === 1 && blocks[0].t === 'Para';
  } catch {
    return false;
  }
}

/**
 * Where a block sits: the columns its lines have, the column it starts at,
 * and whether it is in a list item's content or a fenced div, where more
 * ends a paragraph.
 *
 * @typedef {object} Context
 * @property {number} width
 * @property {number} column
 * @property {boolean} inListItem
 * @property {number} divLevel
 */

/**
 * A paragraph reflowed: filled to the context's width from its column with
 * `always`, on one line between hard breaks with `never`, its line breaks
 * kept with `preserve`. Null where it prints as written.
 *
 * @param {{c: unknown, start: number, end: number}} para
 * @param {View} view
 * @param {{proseWrap: string, pandocTabStop: number}} options
 * @param {Context} context
 * @returns {string | null}
 */
export function reflow(para, view, options, context) {
  const words = wordsOf(para, view);
  if (words === null) return null;
  const read = { tabStop: options.pandocTabStop };
  const where = {
    ...read,
    inListItem: context.inListItem,
    divLevel: context.divLevel,
  };
  const always = options.proseWrap === 'always';
  const preserve = options.proseWrap === 'preserve';
  const { width } = context;
  // Whether a line may start at word `at`, the lines so far `lines`.
  const breaksBefore = (lines, line, at) => {
    const { line: next, next: k } = lineFrom(words, at, width);
    const rest = join(words.slice(k));
    const after = rest === '' ? next : `${next}\n${rest}`;
    if (!continuesParagraph(after, where)) return false;
    return lines.length > 0 || isPara(`${line}\n${after}`, read);
  };
  const text = view.text.slice(view.start(para.start), view.end(para.end));
  // Line breaks moved are judged against the paragraph as one.
  if (!preserve && !isPara(text, read)) {
    return null;
  }
  const lines = [];
  let line = words[0].word;
  let used = context.column;
  for (let k = 1; k < words.length; k++) {
    const { word, before } = words[k];
    if (before === 'hard' || (preserve && before === 'soft')) {
      lines.push(line);
      line = word;
      used = 0;
      continue;
    }
    const joined = `${line} ${word}`;
    const indent = joined.includes('\n') ? 0 : used;
    if (!always || indent + widthOf(joined) <= width) {
      line = joined;
    } else if (breaksBefore(lines, line, k)) {
      lines.push(line);
      line = word;
      used = 0;
    } else {
      line = joined;
    }
  }
  lines.push(line);
  return lines.join('\n');
}
