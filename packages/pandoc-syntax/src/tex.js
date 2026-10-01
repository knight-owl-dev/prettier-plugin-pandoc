// TeX environments, which a raw block and an inline span both hold.

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A `%` comment, which hides from TeX the rest of its line.
const COMMENT = /(?<!\\)%.*$/gm;

// `text` with each comment blanked, its offsets kept.
const uncommented = (text) =>
  text.replace(COMMENT, (comment) => ' '.repeat(comment.length));

/** An environment's `\begin`, its name captured. */
export const BEGIN = '\\\\begin\\{([^}]+)\\}';

/**
 * Where the environment named `name` ends: the chunk holding its matching
 * `\end`, and the offset just past it, counting nested ones of the same name.
 * The first chunk starts at the `\begin`. Null when it never ends, which
 * Pandoc reads as text.
 *
 * @param {string} name
 * @param {Iterable<{text: string, start: number}>} chunks The text in order,
 *   each piece with its offset into the source, read only as far as the end.
 * @returns {{chunk: number, end: number} | null}
 */
export function environmentEnd(name, chunks) {
  const marker = new RegExp(`\\\\(begin|end)\\{${escapeRegExp(name)}\\}`, 'g');
  let [depth, chunk] = [0, 0];
  for (const { text, start } of chunks) {
    for (const m of uncommented(text).matchAll(marker)) {
      depth += m[1] === 'begin' ? 1 : -1;
      if (depth === 0) return { chunk, end: start + m.index + m[0].length };
    }
    chunk++;
  }
  return null;
}
