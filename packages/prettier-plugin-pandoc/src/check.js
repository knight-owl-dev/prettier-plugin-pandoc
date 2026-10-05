// The self-check: the output read again must read as the source does, soft
// breaks as spaces — where a line wraps is the one thing formatting may
// change. Where it reads differently, those blocks print as written; if it
// still does, the source is the output.

import { readMarkdown, withoutSpans } from '@knight-owl-dev/pandoc-parser';

const SPACE = { t: 'Space' };

// A node's read, spans left out, as text to compare.
const readAs = (node) =>
  JSON.stringify(withoutSpans(node), (_, v) =>
    v?.t === 'SoftBreak' ? SPACE : v,
  );

/**
 * The source's blocks to hold, by index, for the output to read as the
 * source does: those between the reads' common start and end, and one on
 * either side, whose gaps may have made the difference. Null where the
 * reads are the same.
 *
 * @param {{meta: object, blocks: object[]}} source
 * @param {{meta: object, blocks: object[]} | null} output
 * @returns {number[] | null}
 */
function differing(source, output) {
  if (output === null) return source.blocks.map((_, k) => k);
  const a = source.blocks.map(readAs);
  const b = output.blocks.map(readAs);
  const n = a.length;
  if (readAs(source.meta) !== readAs(output.meta)) return a.map((_, k) => k);
  let i = 0;
  while (i < n && i < b.length && a[i] === b[i]) i++;
  if (i === n && i === b.length) return null;
  let j = 0;
  while (j < n - i && j < b.length - i && a[n - 1 - j] === b[b.length - 1 - j])
    j++;
  const out = [];
  for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, n - j); k++)
    out.push(k);
  return out;
}

/**
 * What `render` prints holding the blocks that read differently, or the
 * source where that still does.
 *
 * @param {{meta: object, blocks: object[]}} root The source's read.
 * @param {{originalText: string, pandocTabStop: number}} options
 * @param {(held: Set<number>) => string} render
 */
export function heldBlocks(root, options, render) {
  // Text that fails to read — YAML that is none — reads differently.
  const read = (text) => {
    try {
      return readMarkdown(text, { tabStop: options.pandocTabStop });
    } catch {
      return null;
    }
  };
  const held = new Set();
  const out = render(held);
  const diff = differing(root, read(out));
  if (diff === null) return out;
  for (const k of diff) held.add(k);
  const again = render(held);
  return differing(root, read(again)) === null ? again : options.originalText;
}
