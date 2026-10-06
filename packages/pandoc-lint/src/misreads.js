// What Pandoc reads other than as written, and logs nothing of: a block
// a paragraph swallows, and a div's closing fence that pairs with another
// opener than its length shows. Found in the parser's read, so Pandoc's
// rules decide, not a pattern.

import { readMarkdown } from '@knight-owl-dev/pandoc-parser';

/**
 * A misread, as the log's messages are: its type, span and fields.
 *
 * @typedef {{type: string, start: number, end: number} & Record<string, unknown>} Misread
 */

// The blocks a paragraph swallows, by the name the problem gives them.
const SWALLOWED = {
  Div: (line) => (/^\s*:/.test(line) ? 'div fence' : 'div'),
  CodeBlock: (line) => (/^\s*(```|~~~)/.test(line) ? 'code fence' : null),
  Header: () => 'heading',
  BlockQuote: () => 'block quote',
  BulletList: () => 'list',
  OrderedList: () => 'list',
};

// What a line any of those blocks opens starts with: its marker or fence,
// a list's number or letter. A line that starts otherwise is not read.
const OPENS = /^\s*(?:[:~#>*+\-(<@]|\d|[A-Za-z]{1,4}[.)])/;

// Inlines a line may start inside of without being one.
const FLAT = new Set(['Str', 'Space', 'SoftBreak', 'LineBreak']);

/**
 * The misreads in the read `doc` of `text`.
 *
 * @param {{blocks: object[], log: {type: string, start: number}[]}} doc
 * @param {string} text
 * @param {{tabStop?: number}} options
 * @returns {Misread[]}
 */
export function misreads(doc, text, options) {
  const out = [];
  const unclosed = new Set(
    doc.log.filter((m) => m.type === 'UnclosedDiv').map((m) => m.start),
  );
  const top = {
    text,
    inner: (offset) => offset,
    outer: (offset) => offset,
  };
  const candidates = [];
  visit(doc.blocks, top, [], { out, unclosed, candidates });
  out.push(...readAlone(candidates, options));
  return out;
}

// What Pandoc reads alone between paragraphs, after a blank line: Div
// openers closed and HTML divs ended after each, so one candidate's block
// holds no other's. All lines are read at once but fences, whose code
// ends at their closer, read with the text after them.
const APART = '\n\n:::\n\n</div>\n\n';

function readAlone(candidates, options) {
  const out = [];
  const batch = [];
  let joined = '';
  for (const c of candidates) {
    if (c.rest !== null) {
      const [first] = readMarkdown(c.rest, options).blocks;
      if (first?.start === 0) report(out, c, first);
      continue;
    }
    batch.push({ ...c, at: joined.length });
    joined += c.line + APART;
  }
  if (batch.length === 0) return out;
  const firsts = new Map();
  outermost(readMarkdown(joined, options).blocks, firsts);
  for (const c of batch) {
    const block = firsts.get(c.at + c.line.search(/\S/));
    if (block !== undefined) report(out, c, block);
  }
  return out;
}

// Each block by where it starts, the outermost first.
function outermost(value, firsts) {
  if (!Array.isArray(value)) return;
  for (const v of value) {
    if (v?.t !== undefined && !firsts.has(v.start)) firsts.set(v.start, v);
    if (v?.t !== undefined) outermost(v.c, firsts);
    else outermost(v, firsts);
  }
}

// A candidate the block `block` starts at, where it is one a paragraph
// swallows.
function report(out, c, block) {
  const name = SWALLOWED[block.t]?.(c.line);
  if (name)
    out.push({
      type: 'BlockInParagraph',
      start: c.start,
      end: c.end,
      block: name,
    });
}

// A block list read in `view`, the fenced divs open around it in `open`.
function visit(blocks, view, open, at) {
  for (const block of blocks) {
    if (block?.t === 'Para' || block?.t === 'Plain') swallowed(block, view, at);
    if (block?.t === 'Div') {
      const fence = fenceOf(block, view, open);
      if (fence !== null) closerOf(block, fence, view, at);
      const inside = fence === null ? open : [...open, fence];
      children(block.c, view, inside, at);
    } else if (block?.t !== undefined) {
      children(block.c, view, open, at);
    }
  }
}

// Each block list among `value`'s, in its contents' view where it has them.
function children(value, view, open, at) {
  if (!Array.isArray(value)) return;
  if (value.some((v) => v?.t !== undefined)) {
    const { contents } = value;
    const inner =
      contents === undefined
        ? view
        : {
            text: contents.text,
            inner: (offset) => contents.toInnerStart(offset),
            outer: (offset) => contents.toOuterStart(offset),
          };
    visit(value, inner, open, at);
    return;
  }
  for (const v of value) children(v, view, open, at);
}

// Each line of a paragraph after its first that might open a block, for
// `readAlone` to read as a blank line before it would have it read.
function swallowed(para, view, { candidates }) {
  const from = view.inner(para.start);
  const to = view.inner(para.end);
  const spans = inlineSpans(para.c);
  for (
    let nl = view.text.indexOf('\n', from);
    nl !== -1 && nl + 1 < to;
    nl = view.text.indexOf('\n', nl + 1)
  ) {
    const lineStart = nl + 1;
    const start = view.outer(lineStart);
    if (spans.some(([s, e]) => s < start && start < e)) continue;
    const lineEnd = view.text.indexOf('\n', lineStart);
    const line = view.text.slice(lineStart, lineEnd === -1 ? to : lineEnd);
    if (!OPENS.test(line)) continue;
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    const rest =
      fence === undefined ? null : fenced(view.text, lineStart, fence);
    // An unclosed fence is paragraph text after a blank line too.
    if (rest === '') continue;
    candidates.push({
      line,
      start,
      end: view.outer(lineStart + line.length),
      rest,
    });
  }
}

// The text from a fence at `from` through the line closing it, a fence of
// its character at least as long; empty where none closes it.
function fenced(text, from, fence) {
  const closer = new RegExp(
    `\\n[ \\t]*${fence[0]}{${fence.length},}[ \\t]*(?:\\n|$)`,
    'g',
  );
  closer.lastIndex = text.indexOf('\n', from);
  if (closer.lastIndex === -1) return '';
  const m = closer.exec(text);
  return m === null ? '' : text.slice(from, m.index + m[0].length);
}

// The spans of inlines a line may not start inside of.
function inlineSpans(inlines, out = []) {
  for (const node of inlines) {
    if (node?.t === undefined) continue;
    if (!FLAT.has(node.t)) out.push([node.start, node.end]);
    if (Array.isArray(node.c)) inlineSpans(node.c.flat(2), out);
  }
  return out;
}

/**
 * A fenced div's opening fence: its colons, where it is, and the lengths
 * of the openers in its outermost fenced div; null for a div of HTML.
 *
 * @returns {{colons: number, start: number, end: number, nest: Set<number>} | null}
 */
function fenceOf(div, view, open) {
  const colons = colonsAt(view, view.inner(div.start));
  if (colons === null) return null;
  const from = view.inner(div.start);
  const lineEnd = view.text.indexOf('\n', from);
  const end = view.outer(lineEnd === -1 ? view.text.length : lineEnd);
  const nest = open[0]?.nest ?? openers(div, view, new Set());
  return { colons, start: div.start, end, nest };
}

// The colons opening the line at `from`, null where it opens with none.
function colonsAt(view, from) {
  return /^:{3,}/.exec(view.text.slice(from, from + 64))?.[0].length ?? null;
}

// The lengths of the openers of `div` and the fenced divs in it.
function openers(div, view, lengths) {
  const colons = colonsAt(view, view.inner(div.start));
  if (colons !== null) lengths.add(colons);
  for (const block of div.c[1]) {
    if (block?.t === 'Div') openers(block, view, lengths);
  }
  return lengths;
}

// A closing fence whose length is not its opener's, in a nest whose
// openers differ in length: the pairing the lengths show is not Pandoc's.
function closerOf(div, fence, view, { out, unclosed }) {
  if (unclosed.has(div.start) || fence.nest.size < 2) return;
  const to = view.inner(div.end);
  const lineStart = view.text.lastIndexOf('\n', to - 1) + 1;
  const line = view.text.slice(lineStart, to);
  const closer = /^\s*(:{3,})\s*$/.exec(line);
  if (closer === null || lineStart <= view.inner(div.start)) return;
  const colons = closer[1].length;
  if (colons === fence.colons) return;
  out.push({
    type: 'DivFenceLength',
    start: view.outer(lineStart),
    end: div.end,
    colons,
    opener: { colons: fence.colons, start: fence.start, end: fence.end },
  });
}
