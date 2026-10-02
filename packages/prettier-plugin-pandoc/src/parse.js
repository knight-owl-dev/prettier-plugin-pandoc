// Parsing: mask what Pandoc reads differently, parse with prettier's own
// markdown parser, and settle the masked constructs into its tree.

import {
  blocks,
  DEFAULT_TAB_STOP,
  inlines,
} from '@knight-owl-dev/pandoc-syntax';
import * as markdown from 'prettier/plugins/markdown';
import { firstMisread, isContainer } from './containers.js';
import { joinTouching, mask, maskable } from './mask.js';
import { CONTAINERS } from './nodes.js';
import { settle } from './settle.js';
import { stretchAround } from './stretch.js';
import { lineEnd, stopOf } from './text.js';
import { firstUnread, folded, unreadLines } from './unread.js';

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

const byStart = (a, b) => a.start - b.start;

const BLANK_AFTER = /[ \t]*(\n[ \t]*(\n|$)|$)/y;

// Whether only a blank line, or the end, follows the line `at` ends.
const beforeBlank = (text, at) => {
  BLANK_AFTER.lastIndex = at;
  return BLANK_AFTER.test(text);
};

const endOf = (block, text) =>
  block.type === 'div' ? (block.close?.end ?? text.length) : block.end;

// Each raw block with text after it on its line, through that line and any
// block opening there: Pandoc reads blocks again after it, and CommonMark
// never opens one mid-line, a paragraph included.
function afterRaw(found, text) {
  return found
    .filter((raw) => raw.type === 'raw-tex')
    .filter((raw) => text.slice(raw.end, lineEnd(text, raw.end)).trim() !== '')
    .map((raw) => {
      const line = lineEnd(text, raw.end);
      const opened = found.filter(
        (b) => b !== raw && raw.end <= startOf(b) && startOf(b) <= line,
      );
      const ends = opened.map((b) => endOf(b, text));
      return { start: raw.start, end: Math.max(line, ...ends) };
    });
}

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
    inlineRaw: joinTouching(inlines(text, found)).filter((span) =>
      maskable(text, span),
    ),
    containers: found.filter(isContainer),
  };

  // A misread in a container or a fence can shift everything after it, so
  // none after it is judged before the document is parsed again. One printed
  // as written up to a blank line shifts nothing, so the next is settled on
  // the same parse. Every pass prints more as written, so the loop ends.
  const fences = found.filter((block) => block.type === 'fenced-code');
  const resumed = afterRaw(found, text);
  // A block counts until a stretch printed as written holds all of it.
  const unmasked = (blocks) =>
    blocks.filter(
      (b) =>
        !constructs.verbatim.some(
          (v) => v.start <= b.start && stopOf(text, b.start, b.end) <= v.end,
        ),
    );
  // The stretches this parse settles, in order.
  const misread = (ast, masked) => {
    const [shifting] = [
      ...[firstMisread(constructs.containers, ast, text, masked)].filter(
        Boolean,
      ),
      ...[firstUnread(ast, unmasked(fences), text)].filter(Boolean),
    ].sort(byStart);
    const local = [
      ...folded(ast, constructs.verbatim),
      ...unmasked(resumed),
      ...unreadLines(ast, found, constructs.verbatim, text),
    ]
      .filter((m) => shifting === undefined || m.start < shifting.start)
      .sort(byStart);
    const stretches = [];
    for (const m of [...local, shifting].filter(Boolean)) {
      const last = stretches.at(-1);
      if (last !== undefined && m.start <= last.end) continue;
      const stretch = stretchAround(m, ast, constructs, text);
      if (last !== undefined && stretch.start <= last.end) break;
      stretches.push(stretch);
      if (m === shifting || !beforeBlank(text, stretch.end)) break;
    }
    return stretches;
  };
  let masked = mask(text, constructs);
  let ast = await base.parse(masked, options);
  for (
    let stretches = misread(ast, masked);
    stretches.length > 0;
    stretches = misread(ast, masked)
  ) {
    for (const stretch of stretches) {
      constructs = withStretch(constructs, stretch);
    }
    masked = mask(text, constructs);
    ast = await base.parse(masked, options);
  }

  settle(ast, constructs, text);
  ast[CONTAINERS] = found.filter(isContainer);
  return ast;
}
