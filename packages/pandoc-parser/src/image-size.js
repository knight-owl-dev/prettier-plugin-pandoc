// Image dimensions as Pandoc reads them from attributes.
//
// Ported from Pandoc 3.11's `Text.Pandoc.ImageSize`: what readers use.

/**
 * A number and the unit after it; null where it starts with no number
 * Haskell reads as a `Double`.
 *
 * @see Text.Pandoc.ImageSize.numUnit
 * @param {string} s
 * @returns {[number, string] | null}
 */
export function numUnit(s) {
  const nums = /^[0-9.]*/.exec(s)[0];
  if (!/^[0-9]+(\.[0-9]+)?$/.test(nums)) return null;
  return [Number(nums), s.slice(nums.length)];
}

/**
 * A number to five decimals, its trailing zeros dropped, and its point
 * where nothing follows it.
 *
 * @see Text.Pandoc.ImageSize.showFl
 * @param {number} a
 */
export function showFl(a) {
  const t = a.toFixed(5).replace(/0+$/, '');
  return t.endsWith('.') ? t.slice(0, -1) : t;
}
