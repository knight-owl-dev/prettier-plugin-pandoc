// Parsing: mask what Pandoc reads differently, parse with prettier's own
// markdown parser, and settle the masked constructs into its tree.

import {
  blocks,
  DEFAULT_TAB_STOP,
  inlines,
} from '@knight-owl-dev/pandoc-syntax';
import * as markdown from 'prettier/plugins/markdown';
import { firstMisread, isContainer, stretchOf } from './containers.js';
import { mask, maskable } from './mask.js';
import { settle } from './settle.js';

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

  // One misread shifts every container after it, so each is settled before
  // the next is judged: the earliest printed as written, the rest parsed again.
  // Every pass takes the misread container out, so the loop ends.
  let masked = mask(text, constructs);
  let ast = await base.parse(masked, options);
  for (
    let wrong = firstMisread(constructs.containers, ast, text, masked);
    wrong !== undefined;
    wrong = firstMisread(constructs.containers, ast, text, masked)
  ) {
    constructs = withStretch(
      constructs,
      stretchOf(wrong, constructs.containers, text),
    );
    masked = mask(text, constructs);
    ast = await base.parse(masked, options);
  }

  settle(ast, constructs, text);
  return ast;
}
