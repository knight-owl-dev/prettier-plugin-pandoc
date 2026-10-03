// The scan: one document's lines, read line by line against the registry.
//
// A line is read in one of two positions. At a block start — a line's start,
// or where Pandoc resumes after raw TeX — any construct may open on it.
// Inside a paragraph only one that interrupts a paragraph may; any other line
// is the paragraph's text, a fence included. The scan also keeps the div
// stack, and reads each container's content as a document of its own.

import { BLANK, segmentsOf, strip } from '../lines.js';
import { definitionList } from './container.js';
import { DIV_CLOSE } from './div.js';
import { holding } from './held.js';
import { texInParagraph } from './raw-tex.js';
import { INTERRUPTERS, ITEM_INTERRUPTERS, REGISTRY } from './registry.js';

/** @typedef {import('../types.js').Block} Block */
/** @typedef {import('../types.js').Context} Context */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').Match} Match */
/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Span} Span */
/** @typedef {import('../types.js').SpanSpec} SpanSpec */

// Every block a definition term cannot be: a term is paragraph text, which
// Pandoc reads before raw TeX in it can end it.
const NOT_TERMS = REGISTRY.filter(
  (r) => r !== definitionList && r !== texInParagraph,
);

// The containers Pandoc reads as list items. In one, at any depth, a list may
// open straight after a paragraph line.
const ITEMS = new Set(['list-item', 'definition']);

/**
 * @param {Recognizer[]} recognizers
 * @param {Line[]} lines
 * @param {number} at
 * @param {Context} context
 * @returns {Match | null}
 */
function firstMatch(recognizers, lines, at, context) {
  for (const recognizer of recognizers) {
    const match = recognizer.match(lines, at, context);
    if (match !== null) return match;
  }
  return null;
}

/**
 * @param {Line[]} lines
 * @param {SpanSpec} spec
 * @returns {Block}
 */
function toBlock(lines, { type, from, to, start, end }) {
  const [first, last] = [start ?? lines[from].start, end ?? lines[to].end];
  return {
    type,
    start: first,
    end: last,
    segments: segmentsOf(lines, from, to, first, last),
  };
}

/**
 * A container from line `from` to line `to`, with the lines of its content.
 *
 * @param {Line[]} lines
 * @param {number} from
 * @param {number} to
 * @param {import('../types.js').ContainerBlock['type']} type
 * @param {Line[]} content
 * @returns {Block}
 */
function toContainer(lines, from, to, type, content) {
  const [start, end] = [lines[from].start, lines[to].end];
  return {
    type,
    start,
    end,
    segments: segmentsOf(lines, from, to, start, end),
    lines: content.map((line) => ({
      start: line.start,
      end: line.end,
      lazy: line.lazy === true,
    })),
  };
}

/**
 * A context at a block start, outside any div.
 *
 * @param {string} text
 * @param {import('../syntax.js').Syntax} syntax
 * @param {boolean} inItem
 * @returns {Context}
 */
function contextFor(text, syntax, inItem) {
  /** @type {Context} */
  const context = {
    syntax,
    text,
    inDiv: false,
    inItem,
    paragraph: null,
    // Asked at a block start, which is where a term would open.
    opensBlock: (lines, at) =>
      firstMatch(NOT_TERMS, lines, at, { ...context, paragraph: null }) !==
      null,
  };
  return context;
}

/**
 * Whether line 1 ends the one-line paragraph on line 0: it interrupts the
 * paragraph, or a block opening on line 0 claims it, as a definition list
 * claims its term.
 *
 * @param {Line[]} lines
 * @param {string} text
 * @param {import('../syntax.js').Syntax} syntax
 * @param {boolean} inItem Whether the paragraph is in a list item's content,
 *   at any depth.
 */
export function endsParagraph(lines, text, syntax, inItem) {
  const context = contextFor(text, syntax, inItem);
  const opened = firstMatch(REGISTRY, lines, 0, context);
  if (opened !== null && opened.last >= 1) return true;
  const paragraph = {
    ...context,
    paragraph: { lines: 1, start: lines[0].start },
  };
  const interrupters = inItem ? ITEM_INTERRUPTERS : INTERRUPTERS;
  return firstMatch(interrupters, lines, 1, paragraph) !== null;
}

/**
 * Read `lines` into `out`: a document, or a container's content through views
 * whose offsets are still the source's.
 *
 * @param {Line[]} lines
 * @param {string} text The whole source.
 * @param {Block[]} out
 * @param {number} divDepth Divs open around this document, whose closing fence
 *   ends a container inside them.
 * @param {import('../syntax.js').Syntax} syntax
 * @param {boolean} [inItem] Whether `lines` are in a list item's content, at
 *   any depth.
 */
export function scan(lines, text, out, divDepth, syntax, inItem = false) {
  /** @type {Span[]} */
  const open = [];
  /** @type {Context['paragraph']} */
  let paragraph = null;

  const context = contextFor(text, syntax, inItem);
  const held = holding(lines, syntax, inItem);

  /**
   * Report what a match found, and return the line read last: at a resume
   * point, the line before the one read again from it.
   *
   * @param {Match} match
   */
  const take = (match) => {
    for (const spec of match.spans ?? []) out.push(toBlock(lines, spec));
    if (match.divOpen !== undefined) open.push(match.divOpen);
    for (const { type, from, to, content } of match.containers ?? []) {
      out.push(toContainer(lines, from, to, type, content));
      const depth = divDepth + open.length;
      scan(content, text, out, depth, syntax, inItem || ITEMS.has(type));
    }
    paragraph = null;
    if (match.resume === undefined) return match.last;
    const k =
      match.resume <= lines[match.last].end ? match.last : match.last + 1;
    lines[k] = {
      ...lines[k],
      ...strip(lines[k], match.resume - lines[k].start),
    };
    return k - 1;
  };

  // A paragraph Pandoc reads past a blank line, which CommonMark ends there:
  // where it starts, and its last line so far.
  /** @type {{from: number, start: number} | null} */
  let pastBlank = null;
  let last = -1;

  // End the paragraph open, reporting it if it ran past a blank line: on its
  // last line, or before a match opening mid-line on line `n`.
  const endParagraph = (/** @type {Match | null} */ match, n) => {
    const [spec] = match?.spans ?? [];
    const before =
      spec?.from === n && spec.start !== undefined
        ? lines[n].text.slice(0, spec.start - lines[n].start).trimEnd()
        : '';
    if (pastBlank !== null) {
      const [to, end] =
        before === ''
          ? [last, lines[last].end]
          : [n, lines[n].start + before.length];
      out.push(
        toBlock(lines, {
          type: 'paragraph',
          from: pastBlank.from,
          to,
          start: pastBlank.start,
          end,
        }),
      );
    }
    pastBlank = null;
    paragraph = null;
  };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (BLANK.test(line.text)) {
      endParagraph(null, n);
      continue;
    }
    if (open.length > 0 && DIV_CLOSE.test(line.text)) {
      endParagraph(null, n);
      out.push({
        type: 'div',
        open: open.pop(),
        close: { start: line.start, end: line.end },
      });
      continue;
    }

    context.inDiv = divDepth + open.length > 0;
    context.paragraph = paragraph;
    const interrupters = inItem ? ITEM_INTERRUPTERS : INTERRUPTERS;
    const match = firstMatch(
      paragraph === null ? REGISTRY : interrupters,
      lines,
      n,
      context,
    );
    if (match !== null) {
      endParagraph(match, n);
      n = take(match);
      continue;
    }
    if (paragraph === null) paragraph = { lines: 1, start: line.start };
    else paragraph.lines++;
    last = n;

    // Pandoc reads a paragraph's inlines before asking any line whether it
    // opens a block: the lines a construct spans are the paragraph's, and on
    // the line it ends on, only raw TeX after it may end the paragraph.
    const first = n - paragraph.lines + 1;
    let k = n;
    let raw = null;
    for (let next = held.through(k); next !== k; next = held.through(k)) {
      if (
        pastBlank === null &&
        lines.slice(k + 1, next).some((l) => BLANK.test(l.text))
      ) {
        pastBlank = { from: first, start: paragraph.start };
      }
      k = next;
      paragraph.lines = k - first;
      context.paragraph = paragraph;
      raw = texInParagraph.match(lines, k, context);
      if (raw !== null) break;
      paragraph.lines++;
    }
    if (raw !== null) {
      endParagraph(raw, k);
      n = take(raw);
    } else {
      n = last = k;
    }
  }
  endParagraph(null, lines.length);

  // A div never closed runs to the end of the document.
  for (const span of open) out.push({ type: 'div', open: span, close: null });
}
