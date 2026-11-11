// Where a code point ends: Pandoc's input is a stream of code points, and a
// surrogate without its other half is a code point of its own.

/**
 * The UTF-16 length of the code point at `pos`: 2 for a surrogate pair, else 1.
 *
 * @param {string} text
 * @param {number} pos
 * @returns {1 | 2}
 */
export function codePointLength(text, pos) {
  const high = text.charCodeAt(pos);
  if (high < 0xd800 || high > 0xdbff) return 1;
  const low = text.charCodeAt(pos + 1);
  return low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
}

/**
 * Haskell's order of `Text`: by code point, where JavaScript's compares
 * UTF-16 code units.
 *
 * @param {string} a
 * @param {string} b
 */
export function byCodePoint(a, b) {
  const [x, y] = [[...a], [...b]];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = x[k].codePointAt(0) - y[k].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
