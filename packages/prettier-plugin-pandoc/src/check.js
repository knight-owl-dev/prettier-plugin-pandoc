// The self-check: the output read again must read as the source does, soft
// breaks as spaces — where a line wraps is the one thing formatting may
// change. Where it reads differently, those blocks print as written; if it
// still does, the source is the output.

import { readMarkdown, withoutSpans } from '@knight-owl-dev/pandoc-parser';
import { languageOf, parserFor } from './code.js';

const SPACE = { t: 'Space' };

/**
 * A node's read, spans left out, as text to compare: a formatted sample by
 * its attributes alone, prettier's to lay out, as the oracle compares it.
 *
 * @param {{pandocSamples?: Map<object, string>, plugins: object[]}} options
 */
const readerOf = (options) => {
  const formats = options.pandocSamples?.size > 0;
  return (node) =>
    JSON.stringify(withoutSpans(node), (_, v) => {
      if (v?.t === 'SoftBreak') return SPACE;
      if (
        formats &&
        v?.t === 'CodeBlock' &&
        parserFor(languageOf(v), options)
      ) {
        return { t: 'CodeBlock', c: [v.c[0]] };
      }
      return v;
    });
};

/**
 * The source's blocks that read differently, by index: those between the
 * reads' common start and end, or the one before and after where none is.
 * Null where the reads are the same.
 *
 * @param {{meta: object, blocks: object[]}} source
 * @param {{meta: object, blocks: object[]} | null} output
 * @returns {number[] | null}
 */
function differing(source, output, readAs) {
  const all = source.blocks.map((_, k) => k);
  if (output === null) return all;
  const a = source.blocks.map(readAs);
  const b = output.blocks.map(readAs);
  const n = a.length;
  if (readAs(source.meta) !== readAs(output.meta)) return all;
  let i = 0;
  while (i < n && i < b.length && a[i] === b[i]) i++;
  if (i === n && i === b.length) return null;
  let j = 0;
  while (j < n - i && j < b.length - i && a[n - 1 - j] === b[b.length - 1 - j])
    j++;
  // None of the source's differs where the output has one more: the gaps
  // around it made it.
  const [from, to] = i < n - j ? [i, n - j] : [i - 1, i + 1];
  return all.slice(Math.max(0, from), Math.min(n, to));
}

// Rounds of holding what reads differently before the source is the output.
const ROUNDS = 4;

/**
 * What `render` prints holding the blocks that read differently, or the
 * source where that still does. Each round holds what the last left
 * differing, and its neighbors where that was held already: holding no
 * more than needs it, a second format holds the same.
 *
 * @param {{meta: object, blocks: object[]}} root The source's read.
 * @param {{originalText: string, pandocTabStop: number}} options
 * @param {(held: Set<number>) => string} render
 */
export function heldBlocks(root, options, render) {
  const readAs = readerOf(options);
  // Text that fails to read — YAML that is none — reads differently.
  const read = (text) => {
    try {
      return readMarkdown(text, { tabStop: options.pandocTabStop });
    } catch {
      return null;
    }
  };
  const held = new Set();
  for (let round = 0; round < ROUNDS; round++) {
    const out = render(held);
    const diff = differing(root, read(out), readAs);
    if (diff === null) return out;
    const size = held.size;
    for (const k of diff) held.add(k);
    if (held.size === size) {
      for (const k of diff) held.add(k - 1).add(k + 1);
    }
  }
  return options.originalText;
}
