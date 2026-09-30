// Parsing: mask what Pandoc reads differently, parse with prettier's own
// markdown parser, and settle the masked constructs into its tree.

import {
  blocks,
  DEFAULT_TAB_STOP,
  inlines,
} from '@knight-owl-dev/pandoc-syntax';
import * as markdown from 'prettier/plugins/markdown';
import { firstMisread, isContainer } from './containers.js';
import { mask, maskable } from './mask.js';
import { CONTAINERS } from './nodes.js';
import { settle } from './settle.js';
import { stretchAround } from './stretch.js';
import { firstFolded, firstUnread } from './unread.js';

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */

const base = markdown.parsers.markdown;

// Printed as written: raw TeX is another language's source, verse is its line
// breaks, and a table's layout is its meaning — a pipe table past the column
// width takes its column widths from its dashes. Definition,
// example and fancy lists are CommonMark paragraphs to prettier's parser.
// Indented code is code at Pandoc's tab stop, which CommonMark's fixed one of
// four need not agree with.
const VERBATIM = new Set([
  'indented-code',
  'raw-tex',
  'line-block',
  'pipe-table',
  'grid-table',
  'simple-table',
  'multiline-table',
  'definition-list',
  'example-list',
  'fancy-list',
]);

const startOf = (block) =>
  block.type === 'div' ? block.open.start : block.start;

/**
 * The constructs to mask with `stretch` printed as written instead: whatever
 * it holds is its to print, and a mask inside it would overlap its own.
 */
function withStretch(constructs, stretch) {
  const outside = (block) =>
    startOf(block) < stretch.start || startOf(block) > stretch.end;
  return {
    divs: constructs.divs.filter(outside),
    verbatim: [...constructs.verbatim.filter(outside), stretch].sort(
      (a, b) => a.start - b.start,
    ),
    inlineRaw: constructs.inlineRaw.filter(outside),
    containers: constructs.containers.filter(outside),
  };
}

/**
 * @param {string} text
 * @param {{pandocTabStop?: number}} options Prettier's options, this plugin's
 *   among them.
 */
export async function parse(text, options) {
  const found = blocks(text, {
    tabStop: options.pandocTabStop ?? DEFAULT_TAB_STOP,
  });
  let constructs = {
    divs: found.filter((block) => block.type === 'div'),
    verbatim: found.filter((block) => VERBATIM.has(block.type)),
    inlineRaw: inlines(text, found).filter((span) => maskable(text, span)),
    containers: found.filter(isContainer),
  };

  // One misread shifts everything after it, so each is settled before the
  // next is judged: the earliest printed as written, the rest parsed again.
  // Every pass prints more of the document as written, so the loop ends.
  const fences = found.filter((block) => block.type === 'fenced-code');
  // A fence counts until a stretch printed as written holds all of it.
  const unmasked = (blocks) =>
    blocks.filter(
      (b) =>
        !constructs.verbatim.some((v) => v.start <= b.start && b.end <= v.end),
    );
  const misread = (ast, masked) => {
    const at = (offset) =>
      offset === undefined ? [] : [{ start: offset, end: offset }];
    const misreads = [
      ...at(firstMisread(constructs.containers, ast, text, masked)),
      ...[firstUnread(ast, unmasked(fences), text)].filter(Boolean),
      ...[firstFolded(ast, constructs.verbatim)].filter(Boolean),
    ];
    if (misreads.length === 0) return undefined;
    const first = misreads.reduce((a, b) => (b.start < a.start ? b : a));
    return stretchAround(first, ast, constructs.containers, text);
  };
  let masked = mask(text, constructs);
  let ast = await base.parse(masked, options);
  for (
    let stretch = misread(ast, masked);
    stretch !== undefined;
    stretch = misread(ast, masked)
  ) {
    constructs = withStretch(constructs, stretch);
    masked = mask(text, constructs);
    ast = await base.parse(masked, options);
  }

  settle(ast, constructs, text);
  ast[CONTAINERS] = found.filter(isContainer);
  return ast;
}
