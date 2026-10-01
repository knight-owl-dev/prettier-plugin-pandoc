// Text primitives over the source string.

/**
 * The offset of the end of the line `at` is on, its newline excluded.
 *
 * @param {string} text
 * @param {number} at
 * @returns {number}
 */
export function lineEnd(text, at) {
  const newline = text.indexOf('\n', at);
  return newline === -1 ? text.length : newline;
}

/**
 * Where the text from `start` to `end` stops, short of trailing whitespace: a
 * block's end as a stretch printed as written measures it.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
export const stopOf = (text, start, end) =>
  start + text.slice(start, end).trimEnd().length;

/**
 * The lines from `start` to `end`, each as its own span.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {{start: number, end: number}[]}
 */
export function lineSpans(text, start, end) {
  const spans = [];
  for (let at = start; at <= end; at = lineEnd(text, at) + 1) {
    spans.push({ start: at, end: Math.min(lineEnd(text, at), end) });
  }
  return spans;
}
