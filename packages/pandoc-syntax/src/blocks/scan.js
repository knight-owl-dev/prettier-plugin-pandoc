// The scan: one document's lines, read line by line against the registry.
//
// A line is read in one of two positions. At a block start any construct may
// open on it. Inside a paragraph only one that interrupts a paragraph may; any
// other line is the paragraph's text, a fence included. The scan also keeps the
// div stack, and reads each container's content as a document of its own.

import { BLANK, segmentsOf } from '../lines.js';
import { DIV_CLOSE } from './div.js';
import { definitionList } from './list.js';
import { mergeAdjacent } from './raw-tex.js';
import { INTERRUPTERS, REGISTRY } from './registry.js';

/** @typedef {import('../types.js').Block} Block */
/** @typedef {import('../types.js').Context} Context */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').Match} Match */
/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Span} Span */
/** @typedef {import('../types.js').SpanSpec} SpanSpec */

// Every block a definition term cannot be: a term is paragraph text.
const NOT_TERMS = REGISTRY.filter((r) => r !== definitionList);

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
 * @param {'block-quote' | 'list-item'} type
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
 * Read `lines` into `out`: a document, or a container's content through views
 * whose offsets are still the source's.
 *
 * @param {Line[]} lines
 * @param {string} text The whole source.
 * @param {Block[]} out
 * @param {number} divDepth Divs open around this document, whose closing fence
 *   ends a container inside them.
 */
export function scan(lines, text, out, divDepth) {
  /** @type {Span[]} */
  const open = [];
  /** @type {SpanSpec[]} */
  const raws = [];
  /** @type {{lines: number} | null} */
  let paragraph = null;

  /** @type {Context} */
  const context = {
    text,
    inDiv: false,
    paragraph: null,
    // Asked at a block start, which is where a term would open.
    opensBlock: (lines, at) =>
      firstMatch(NOT_TERMS, lines, at, { ...context, paragraph: null }) !==
      null,
  };

  /**
   * Report what a match at line `at` found, and return its last line.
   *
   * @param {Match} match
   * @param {number} at
   */
  const take = (match, at) => {
    for (const spec of match.spans ?? []) {
      // Raw spans wait to be merged with their neighbors.
      if (spec.type === 'raw-tex') raws.push(spec);
      else out.push(toBlock(lines, spec));
    }
    if (match.divOpen !== undefined) open.push(match.divOpen);
    if (match.container !== undefined) {
      const { type, content } = match.container;
      out.push(toContainer(lines, at, match.last, type, content));
      scan(content, text, out, divDepth + open.length);
    }
    paragraph = match.after === 'paragraph' ? { lines: 1 } : null;
    return match.last;
  };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (BLANK.test(line.text)) {
      paragraph = null;
      continue;
    }
    if (open.length > 0 && DIV_CLOSE.test(line.text)) {
      out.push({
        type: 'div',
        open: open.pop(),
        close: { start: line.start, end: line.end },
      });
      paragraph = null;
      continue;
    }

    context.inDiv = divDepth + open.length > 0;
    context.paragraph = paragraph;
    const match = firstMatch(
      paragraph === null ? REGISTRY : INTERRUPTERS,
      lines,
      n,
      context,
    );
    if (match !== null) n = take(match, n);
    else if (paragraph === null) paragraph = { lines: 1 };
    else paragraph.lines++;
  }

  // A div never closed runs to the end of the document.
  for (const span of open) out.push({ type: 'div', open: span, close: null });
  for (const spec of mergeAdjacent(raws)) out.push(toBlock(lines, spec));
}
