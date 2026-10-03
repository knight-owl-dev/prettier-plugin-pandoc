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

// The parses the choice of spans to mask may take to settle.
const SETTLING = 8;

// Where prettier prints the text it parsed, mask and all: raw HTML, a math
// block, a liquid tag or wiki link, a reference definition and an image
// whole, and a link past its text — its destination and title.
const LITERAL = new Set([
  'html',
  'math',
  'liquidNode',
  'wikiLink',
  'definition',
  'image',
  'imageReference',
]);
const PAST_TEXT = new Set(['link', 'linkReference']);

function literalSpans(node, out = []) {
  const { position } = node;
  if (LITERAL.has(node.type) && position !== undefined) {
    out.push({ start: position.start.offset, end: position.end.offset });
  } else if (PAST_TEXT.has(node.type) && position !== undefined) {
    const text = node.children?.at(-1)?.position;
    const start = text?.end.offset ?? position.start.offset;
    out.push({ start, end: position.end.offset });
  }
  for (const child of node.children ?? []) literalSpans(child, out);
  return out;
}

const sameSpans = (a, b) =>
  a.length === b.length && a.every((span, n) => span === b[n]);

// The spans starting inside any of `within`.
const spansIn = (within, spans) =>
  new Set(
    spans.filter((s) =>
      within.some((w) => w.start <= s.start && s.start < w.end),
    ),
  );

// The blocks outside every block printed as written, which prints what it
// holds: a definition list's definitions, say.
function outsideVerbatim(found) {
  const verbatim = found.filter((block) => VERBATIM.has(block.type));
  return found.filter(
    (block) =>
      !verbatim.some(
        (v) =>
          v !== block && v.start <= startOf(block) && startOf(block) < v.end,
      ),
  );
}

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
 * Throw where a pass would not print more as written: a stretch already held
 * as written changes nothing in the mask, so a pass of only those never ends.
 *
 * @param {{start: number, end: number}[]} stretches
 * @param {{start: number, end: number}[]} verbatim
 */
function settles(stretches, verbatim) {
  const held = (s) =>
    verbatim.some((v) => v.start <= s.start && s.end <= v.end);
  if (stretches.every(held)) {
    const [{ start, end }] = stretches;
    throw new Error(`a misread at offsets ${start}–${end} never settles`);
  }
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
  const tabStop = options.pandocTabStop ?? DEFAULT_TAB_STOP;
  const found = outsideVerbatim(blocks(text, { tabStop }));
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
  // the same parse. Every pass prints more as written, so the loop ends:
  // `settles` enforces it.
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
  const misread = (ast, masked, moving) => {
    const [shifting] = [
      ...[firstMisread(constructs.containers, ast, text, masked)].filter(
        Boolean,
      ),
      ...[firstUnread(ast, unmasked(fences), text)].filter(Boolean),
    ].sort(byStart);
    const local = [
      ...moving,
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
      const stretch = stretchAround(m, ast, constructs, text, masked);
      if (last !== undefined && stretch.start <= last.end) break;
      stretches.push(stretch);
      if (m === shifting || !beforeBlank(text, stretch.end)) break;
    }
    return stretches;
  };
  // Prettier prints some text as it parsed it, `literalSpans`, so a span there
  // stays unmasked — there in the parse it prints from, since a mask can hide
  // the tag that opens or ends that text. Each parse unmasks the spans it puts
  // there and masks again those it no longer does, until none moves. A span
  // that moves back, or still moves after `SETTLING` rounds, is one the two
  // parsers cannot agree on: a misread, printed as written. Each pass starts
  // from where the last one settled.
  let leftOut = new Set();
  const parseMasked = async () => {
    const all = constructs.inlineRaw;
    let masks = all.filter((span) => !leftOut.has(span));
    let before = null;
    for (let round = 1; ; round++) {
      const masked = mask(text, { ...constructs, inlineRaw: masks });
      const ast = await base.parse(masked, options);
      const inLiteral = spansIn(literalSpans(ast), all);
      const next = all.filter((span) => !inLiteral.has(span));
      const masking = new Set(masks);
      const moving = all.filter(
        (span) => masking.has(span) === inLiteral.has(span),
      );
      // Back where it was two parses ago: it moves for good.
      const cycles = before !== null && sameSpans(next, before);
      if (moving.length === 0 || cycles || round === SETTLING) {
        leftOut = new Set(all.filter((span) => inLiteral.has(span)));
        return { masked, ast, inlineRaw: masks, moving };
      }
      before = masks;
      masks = next;
    }
  };
  let { masked, ast, inlineRaw, moving } = await parseMasked();
  for (
    let stretches = misread(ast, masked, moving);
    stretches.length > 0;
    stretches = misread(ast, masked, moving)
  ) {
    settles(stretches, constructs.verbatim);
    for (const stretch of stretches) {
      constructs = withStretch(constructs, stretch);
    }
    ({ masked, ast, inlineRaw, moving } = await parseMasked());
  }

  settle(ast, { ...constructs, inlineRaw }, text, tabStop);
  ast[CONTAINERS] = found.filter(isContainer);
  return ast;
}
