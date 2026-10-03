// The mask: each Pandoc construct overwritten in place with what makes the
// stock CommonMark parser see what Pandoc sees there.
//
// Offsets must stay true to the source, so every fill is exactly as long as
// what it covers, and the mask is spliced by slice: offsets are UTF-16 code
// units, as the stock parser counts them.

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */
/** @typedef {{start: number, end: number}} Span */

// A div's fence line blanks to spaces: to CommonMark, a blank line, the break
// Pandoc reads there.
const blank = (length) => ' '.repeat(length);

// A verbatim block's line becomes an ATX heading: a block that ends on its own
// line and interrupts a paragraph, as raw TeX does. Blanked instead, text after
// a mid-line end would sit behind spaces enough to read as indented code.
const HEADING = '#';
const heading = (length) => HEADING + blank(length - HEADING.length);

// Inline raw TeX and math become code spans, which prettier neither wraps nor
// reads markdown inside. A formula's keeps a `$` in its line, where a `$$`
// opening the line would otherwise open a math block to prettier's parser.
const CODE_SPAN = '`';
const codeSpan = (fill) => (length) =>
  CODE_SPAN + fill.repeat(length - 2 * CODE_SPAN.length) + CODE_SPAN;

// A code span needs a delimiter at each end and something between. Anything
// shorter holds no space to wrap at and no markdown to rewrite.
const SHORTEST_CODE_SPAN = 2 * CODE_SPAN.length + 1;

/**
 * The spans, each run of touching ones joined into one: code spans side by
 * side would run their backticks together.
 *
 * @param {Span[]} spans In source order.
 * @returns {Span[]}
 */
export function joinTouching(spans) {
  const joined = [];
  for (const span of spans) {
    const last = joined.at(-1);
    if (last !== undefined && last.end === span.start) {
      last.end = span.end;
      // A run holding a formula masks as one.
      if (span.type === 'math') last.type = 'math';
    } else {
      joined.push({ type: span.type, start: span.start, end: span.end });
    }
  }
  return joined;
}

/**
 * Whether an inline span can be masked. A backtick beside it would lengthen
 * the run its code span opens or closes on; such a span is left as it is.
 *
 * @param {string} text
 * @param {Span} span
 * @returns {boolean}
 */
export const maskable = (text, span) =>
  span.end - span.start >= SHORTEST_CODE_SPAN &&
  text[span.start - 1] !== CODE_SPAN &&
  text[span.end] !== CODE_SPAN;

/**
 * The source with every construct masked.
 *
 * @param {string} text
 * @param {{divs: Block[], verbatim: Block[], inlineRaw: Span[]}} constructs
 *   Verbatim blocks are masked by their segments, line by line: inside a
 *   container those stop short of its prefix, which stays for the parser.
 * @returns {string}
 */
export function mask(text, { divs, verbatim, inlineRaw }) {
  const edits = [
    ...divs
      .flatMap((div) => [div.open, div.close])
      .filter((span) => span !== null)
      .map((span) => ({ ...span, fill: blank })),
    ...verbatim.flatMap((block) =>
      block.segments
        .filter((segment) => segment.end > segment.start)
        .map((segment) => ({ ...segment, fill: heading })),
    ),
    ...inlineRaw.map((span) => ({
      ...span,
      fill: codeSpan(span.type === 'math' ? '$' : 'x'),
    })),
  ].sort((a, b) => a.start - b.start);

  let masked = '';
  let at = 0;
  for (const edit of edits) {
    masked += text.slice(at, edit.start) + edit.fill(edit.end - edit.start);
    at = edit.end;
  }
  return masked + text.slice(at);
}
