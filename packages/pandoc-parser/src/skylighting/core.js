// Skylighting's syntaxes looked up by file name.
//
// Ported from skylighting-core 0.14.7's `Skylighting.Core`: the lookups by
// extension. The syntaxes are `syntaxes.js`.

import { SYNTAXES } from './syntaxes.js';

/**
 * Whether `fn` matches a glob whose `*` matches any run of characters.
 *
 * @see Skylighting.Core.matchGlob
 * @param {string} glob
 * @param {string} fn
 * @returns {boolean}
 */
export function matchGlob(glob, fn) {
  const g = [...glob];
  const f = [...fn];
  const match = (i, j) => {
    if (i === g.length) return j === f.length;
    if (g[i] === '*') {
      for (let k = j; k <= f.length; k++) if (match(i + 1, k)) return true;
      return false;
    }
    return j < f.length && g[i] === f[j] && match(i + 1, j + 1);
  };
  return match(0, 0);
}

/**
 * The names of the syntaxes for a file name, in the syntax map's order.
 *
 * @see Skylighting.Core.syntaxesByFilename
 * @param {string} fn
 * @returns {string[]}
 */
export const syntaxesByFilename = (fn) =>
  SYNTAXES.filter(([, globs]) => globs.some((g) => matchGlob(g, fn))).map(
    ([name]) => name,
  );

/**
 * The names of the syntaxes for a file extension, its dot optional.
 *
 * @see Skylighting.Core.syntaxesByExtension
 * @param {string} ext
 * @returns {string[]}
 */
export const syntaxesByExtension = (ext) =>
  syntaxesByFilename(`*.${ext.startsWith('.') ? ext.slice(1) : ext}`);
