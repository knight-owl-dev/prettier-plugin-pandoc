// Lines of a document, and the views a container's content is read through.
//
// A line records where its text starts and ends in the source. A view of it —
// its indentation or a quote marker removed — moves `start` with the text, so
// an offset found through any view is still an offset into the source.

/** @typedef {import('./types.js').Line} Line */
/** @typedef {import('./types.js').Span} Span */

export const BLANK = /^[ \t]*$/;

/**
 * Split a document into its lines, newlines excluded.
 *
 * @param {string} text
 * @returns {Line[]}
 */
export function splitLines(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    lines.push({ start, end, text: text.slice(start, end) });
    if (newline === -1) return lines;
    start = newline + 1;
  }
}

// The column after `char`, read at `col`: a tab advances to the next multiple
// of `tabStop`. Null for a character that is not indentation.
function advance(col, char, tabStop) {
  if (char === ' ') return col + 1;
  if (char === '\t') return col + tabStop - (col % tabStop);
  return null;
}

/**
 * The column a line's text starts at.
 *
 * @param {string} text
 * @param {number} tabStop
 * @returns {number}
 */
export function indentOf(text, tabStop) {
  let col = 0;
  for (const char of text) {
    const next = advance(col, char, tabStop);
    if (next === null) break;
    col = next;
  }
  return col;
}

/**
 * A view of `line` with up to `cols` columns of its indentation removed.
 *
 * @param {Line} line
 * @param {number} cols
 * @param {number} tabStop
 * @returns {Line}
 */
export function dedent(line, cols, tabStop) {
  let col = 0;
  let i = 0;
  while (i < line.text.length && col < cols) {
    const next = advance(col, line.text[i], tabStop);
    if (next === null) break;
    col = next;
    i++;
  }
  return { start: line.start + i, end: line.end, text: line.text.slice(i) };
}

/**
 * A view of `line` with its first `chars` characters removed.
 *
 * @param {Line} line
 * @param {number} chars
 * @returns {Line}
 */
export function strip(line, chars) {
  return {
    start: line.start + chars,
    end: line.end,
    text: line.text.slice(chars),
  };
}

/**
 * Each line's share of a span from `start` on line `from` to `end` on line
 * `to`: what a caller masks, line by line, without touching a container's
 * prefix between them.
 *
 * @param {Line[]} lines
 * @param {number} from
 * @param {number} to
 * @param {number} start
 * @param {number} end
 * @returns {Span[]}
 */
export function segmentsOf(lines, from, to, start, end) {
  return lines.slice(from, to + 1).map((line, k) => ({
    start: k === 0 ? start : line.start,
    end: k === to - from ? end : line.end,
  }));
}

/**
 * Whether the newline at `at` is followed by a blank line: the break that ends
 * a paragraph, and every inline construct open in it.
 *
 * @param {string} text
 * @param {number} at The offset of a newline.
 * @returns {boolean}
 */
export function breaksParagraph(text, at) {
  const next = text.indexOf('\n', at + 1);
  return BLANK.test(text.slice(at + 1, next === -1 ? text.length : next));
}

/**
 * The offset of the newline that breaks the paragraph `at` is in, or the end
 * of the text.
 *
 * @param {string} text
 * @param {number} at
 * @returns {number}
 */
export function paragraphEnd(text, at) {
  for (
    let i = text.indexOf('\n', at);
    i !== -1;
    i = text.indexOf('\n', i + 1)
  ) {
    if (breaksParagraph(text, i)) return i;
  }
  return text.length;
}

/**
 * The text from `start` on line `from` up to a blank line, or with `whole` to
 * the end of `lines`, and where each line's text sits in it.
 *
 * @param {Line[]} lines
 * @param {number} from
 * @param {number} start
 * @param {boolean} [whole]
 * @returns {{text: string, parts: {at: number, head: number}[]}}
 */
export function viewFrom(lines, from, start, whole = false) {
  const parts = [];
  let text = '';
  for (let k = from; k < lines.length; k++) {
    if (!whole && k > from && BLANK.test(lines[k].text)) break;
    const head = k === from ? start - lines[k].start : 0;
    if (k > from) text += '\n';
    parts.push({ at: text.length, head });
    text += lines[k].text.slice(head);
  }
  return { text, parts };
}

// The pairs found by text, step, opener and nesting, after an opener found no
// close: a pass from it to the paragraph break pairs every opener it steps
// onto, so the openers after it cost nothing. A document and the views read
// from it take turns, so a few texts are kept.
const pairings = new Map();
const KEPT = 8;

/**
 * The offset past the `close` pairing the `open` at `at`, or null when none
 * does before a paragraph break. `step` moves past any other character, as the
 * caller reads it. Unless `nests`, an opener inside closes with the first.
 *
 * @param {string} text
 * @param {number} at
 * @param {string} open
 * @param {string} close
 * @param {(text: string, at: number) => number} step
 * @param {boolean} [nests]
 * @returns {number | null}
 */
export function closeOf(text, at, open, close, step, nests = true) {
  let bySteps = pairings.get(text);
  if (bySteps === undefined) {
    if (pairings.size === KEPT) pairings.clear();
    bySteps = new Map();
    pairings.set(text, bySteps);
  }
  let byOpen = bySteps.get(step);
  if (byOpen === undefined) {
    byOpen = new Map();
    bySteps.set(step, byOpen);
  }
  const key = nests ? open : `${open}!`;
  const known = byOpen.get(key);
  if (known?.has(at)) return known.get(at);
  // Most close soon: look for this one alone first.
  let depth = 0;
  for (let i = at; i < text.length; ) {
    const char = text[i];
    if (char === '\n' && breaksParagraph(text, i)) break;
    if (char === open && (nests || depth === 0)) depth++;
    else if (char === close && --depth === 0) return i + 1;
    i = char === open || char === close ? i + 1 : step(text, i);
  }
  /** @type {Map<number, number | null>} */
  const ends = new Map();
  const stack = [];
  for (let i = at; i < text.length; ) {
    const char = text[i];
    if (char === '\n' && breaksParagraph(text, i)) break;
    if (char === open) {
      stack.push(i);
      ends.set(i, null);
      i++;
    } else if (char === close) {
      for (const opener of nests ? stack.splice(-1) : stack.splice(0)) {
        ends.set(opener, i + 1);
      }
      i++;
    } else {
      i = step(text, i);
    }
  }
  byOpen.set(key, ends);
  return ends.get(at) ?? null;
}
