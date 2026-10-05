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

const BREAKS = new Set(['Space', 'SoftBreak', 'LineBreak']);

// The break nodes under `value`, nested ones included.
function breaksIn(value, out) {
  if (Array.isArray(value)) {
    for (const v of value) breaksIn(v, out);
  } else if (value !== null && typeof value === 'object') {
    if (BREAKS.has(value.t)) out.push(value);
    else for (const v of Object.values(value)) breaksIn(v, out);
  }
  return out;
}

const SPACE = /^[ \t]*\n?[ \t]*$/;
const HARD = /^([ \t]*|\\)\n[ \t]*$/;

/**
 * A paragraph's words as written, each with the break before it: `space`,
 * or `hard` for a hard break, which keeps what ends its line. Null where its
 * breaks are not whitespace of its own source, in order — a note's from
 * elsewhere aside.
 *
 * @param {{c: unknown, start: number, end: number}} para
 * @param {string} text
 * @returns {{word: string, before: 'space' | 'hard' | null}[] | null}
 */
function wordsOf(para, text) {
  const breaks = breaksIn(para.c, [])
    .filter((b) => b.start >= para.start && b.end <= para.end)
    .sort((a, b) => a.start - b.start)
    .filter((b, k, bs) => k === 0 || bs[k - 1].start !== b.start);
  const words = [];
  let from = para.start;
  let before = null;
  for (const b of breaks) {
    const gap = text.slice(b.start, b.end);
    if (b.start < from) return null;
    const hard = b.t === 'LineBreak';
    if (!(hard ? HARD : SPACE).test(gap)) return null;
    const kept = hard ? gap.slice(0, gap.indexOf('\n')) : '';
    words.push({ word: text.slice(from, b.start) + kept, before });
    from = b.end;
    before = hard ? 'hard' : 'space';
  }
  words.push({ word: text.slice(from, para.end).trimEnd(), before });
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
  while (k < words.length && words[k].before === 'space') {
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
 * A paragraph reflowed: filled to `printWidth` from `column` with `always`,
 * on one line between hard breaks with `never`. Null where it prints as
 * written.
 *
 * @param {{c: unknown, start: number, end: number}} para
 * @param {string} text
 * @param {number} column Where its first line starts.
 * @param {{proseWrap: string, printWidth: number, pandocTabStop: number}} options
 * @returns {string | null}
 */
export function reflow(para, text, column, options) {
  const words = wordsOf(para, text);
  if (words === null) return null;
  const read = { tabStop: options.pandocTabStop };
  const always = options.proseWrap === 'always';
  const width = options.printWidth;
  // Whether a line may start at word `at`, the lines so far `lines`.
  const breaksBefore = (lines, line, at) => {
    const { line: next, next: k } = lineFrom(words, at, width);
    const rest = join(words.slice(k));
    const after = rest === '' ? next : `${next}\n${rest}`;
    if (!continuesParagraph(after, read)) return false;
    return lines.length > 0 || isPara(`${line}\n${after}`, read);
  };
  if (!isPara(text.slice(para.start, para.end), read)) {
    return null;
  }
  const lines = [];
  let line = words[0].word;
  let used = column;
  for (let k = 1; k < words.length; k++) {
    const { word, before } = words[k];
    if (before === 'hard') {
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
