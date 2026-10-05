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

// Where prettier breaks no line: inside a link.
const SINGLE_LINE = new Set(['Link', 'Image']);

// The break nodes under `value`, nested ones included, each within every
// node around it: a note's contents, read from its definition elsewhere,
// hold none of the paragraph's. A break inside a link is glued.
function breaksIn(value, out, from = -Infinity, to = Infinity, glued = false) {
  if (Array.isArray(value)) {
    for (const v of value) breaksIn(v, out, from, to, glued);
  } else if (value !== null && typeof value === 'object') {
    const spanned =
      Number.isInteger(value.start) && Number.isInteger(value.end);
    if (spanned && (value.start < from || value.end > to)) return out;
    if (BREAKS.has(value.t)) {
      out.push({ t: value.t, start: value.start, end: value.end, glued });
    } else {
      const [inFrom, inTo] = spanned ? [value.start, value.end] : [from, to];
      const inside = glued || SINGLE_LINE.has(value.t);
      for (const v of Object.values(value)) {
        breaksIn(v, out, inFrom, inTo, inside);
      }
    }
  }
  return out;
}

const SPACE = /^[ \t]*\n?[ \t]*$/;
// A TeX command with no arguments: raw TeX takes the spaces after one, but
// stops at a line's end.
const BARE_COMMAND = /\\[A-Za-z@]+\*?[ \t]*$/;
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
 * @property {(offset: number) => boolean} contains Whether its text holds
 *   a source offset.
 */

/**
 * A paragraph's words as written, emphasis markers prettier's
 * (`emphasis.js`), each with the break before it: `space`, `soft` for a
 * line break, `keep` for one after a bare TeX command, which stays one, or
 * `hard` for a hard break, which keeps what ends its line;
 * `glued` where that break is inside a link, which no line break splits.
 * Null where its breaks are not whitespace of its own text, in order — a
 * note's from elsewhere aside.
 *
 * @param {{c: unknown, start: number, end: number}} para
 * @param {View} view
 * @returns {{word: string, before: 'space' | 'soft' | 'keep' | 'hard' | null, glued: boolean}[] | null}
 */
function wordsOf(para, view) {
  const { text } = view;
  const edits = markerEdits(para.c, view).sort((a, b) => a.from - b.from);
  const slice = (from, to) => edited(text, from, to, edits);
  const [start, end] = [view.start(para.start), view.end(para.end)];
  const breaks = breaksIn(para.c, [])
    .filter((b) => b.start >= para.start && b.end <= para.end)
    .map((b) => ({ ...b, start: view.start(b.start), end: view.end(b.end) }))
    .sort((a, b) => a.start - b.start)
    .filter((b, k, bs) => k === 0 || bs[k - 1].start !== b.start);
  const words = [];
  let from = start;
  let before = null;
  let glued = false;
  // After a break, spaces a break's span stops short of: part of a tab.
  // First on its line, the spaces Pandoc skips before a paragraph.
  const first = /^[ \t]*$/.test(
    text.slice(text.lastIndexOf('\n', start - 1) + 1, start),
  );
  const wordFrom = (word) =>
    before === null && !first ? word : word.trimStart();
  for (const b of breaks) {
    const gap = text.slice(b.start, b.end);
    if (b.start < from || b.end > end) return null;
    const hard = b.t === 'LineBreak';
    if (!(hard ? HARD : SPACE).test(gap)) return null;
    // A hard break of spaces or a tab is two spaces; a backslash stays.
    const ending = hard ? gap.slice(0, gap.indexOf('\n')) : '';
    const kept = /^[ \t]+$/.test(ending) ? '  ' : ending;
    const word = wordFrom(slice(from, b.start) + kept);
    words.push({ word, before, glued });
    from = b.end;
    const soft = b.t === 'SoftBreak';
    before = hard
      ? 'hard'
      : soft && BARE_COMMAND.test(word)
        ? 'keep'
        : soft
          ? 'soft'
          : 'space';
    glued = b.glued && !hard;
  }
  // Spaces ending its line go; before a block on the same line they stay.
  const last = wordFrom(slice(from, end));
  const endsLine =
    end === text.length || text[end] === '\n' || /\n[ \t]*$/.test(last);
  // Spaces after a bare command are the command's.
  const word = endsLine && !BARE_COMMAND.test(last) ? last.trimEnd() : last;
  // A hard break ending the text breaks no line after it.
  if (word !== '' || before !== 'hard') words.push({ word, before, glued });
  return words;
}

// Words, each glued one joined onto the word before it.
function unitsOf(words) {
  const out = [];
  for (const w of words) {
    if (w.glued && out.length > 0) {
      const last = out.at(-1);
      out[out.length - 1] = { ...last, word: `${last.word} ${w.word}` };
    } else {
      out.push({ ...w, glued: false });
    }
  }
  return out;
}

// The width of a line's last row.
const widthOf = (line) =>
  util.getStringWidth(line.slice(line.lastIndexOf('\n') + 1));

const join = (words) => words.map(({ word }) => word).join(' ');

// The words from `at` on that fit one line, all of them that do.
function lineFrom(words, at, width) {
  let line = words[at].word;
  let k = at + 1;
  const breaks = (before) => before === 'hard' || before === 'keep';
  while (k < words.length && !breaks(words[k].before)) {
    const next = `${line} ${words[k].word}`;
    if (!words[k].glued && widthOf(next) > width) break;
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
 * @property {string | null} [inHtmlBlock] The HTML block it is in, `div`.
 * @property {boolean} [fresh] Whether a blank line, or nothing, precedes it.
 * @property {number} [siblings] Blocks of its kind right before it.
 * @property {number} [listSiblings] The nearest list's `siblings`.
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
  const written = wordsOf(para, view);
  if (written === null) return null;
  const read = { tabStop: options.pandocTabStop };
  const where = {
    ...read,
    inListItem: context.inListItem,
    divLevel: context.divLevel,
    inHtmlBlock: context.inHtmlBlock ?? null,
  };
  const always = options.proseWrap === 'always';
  const preserve = options.proseWrap === 'preserve';
  // A link fills as one word; `preserve` keeps line breaks in it.
  const words = preserve ? written : unitsOf(written);
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
    const { word, before, glued } = words[k];
    if (
      before === 'hard' ||
      before === 'keep' ||
      (preserve && before === 'soft')
    ) {
      lines.push(line);
      line = word;
      used = 0;
      continue;
    }
    const joined = `${line} ${word}`;
    const indent = joined.includes('\n') ? 0 : used;
    if (!always || glued || indent + widthOf(joined) <= width) {
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
