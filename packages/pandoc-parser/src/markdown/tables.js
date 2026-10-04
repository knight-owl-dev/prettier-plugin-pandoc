// Pipe, simple and multiline tables: a pipe table's cells between pipes,
// the others' columns marked by lines of dashes, each row's lines split
// into cells at the display widths the dashes end at; each cell read again
// as plain blocks; a caption before or after.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `blocks.js`
// imports this module, which imports modules that import `blocks.js`: what
// `blocks.js` imports from here is a function declaration, and what this
// reads from those modules, it reads when called.

import * as B from '../ast/builder.js';
import {
  AlignCenter,
  AlignDefault,
  AlignLeft,
  AlignRight,
  nullAttr,
} from '../ast/nodes.js';
import { char, newline, noneOf, oneOf, satisfy, string } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  many1,
  notFollowedBy,
  option,
  sepBy1,
} from '../core.js';
import {
  anyLine,
  blankline,
  blanklines,
  blockEnd,
  gobbleSpaces,
  nonspaceChar,
  notAhead,
  optionalBlanklines,
  parseFromStringFresh,
  spaceChar,
} from '../parsing/general.js';
import { whenEnabled } from '../parsing/state.js';
import {
  gridTableWith,
  tableWith,
  toTableComponents,
  withDefaultWidths,
} from '../parsing/tables.js';
import { splitTextByIndices } from '../shared.js';
import { SourceText } from '../source-text.js';
import { realLength } from '../text-width.js';
import { attributes } from './attributes.js';
import { parseBlocks, plain } from './blocks.js';
import { skipNonindentSpaces } from './common.js';
import { divFenceEnd, inDiv } from './divs.js';
import { code, escapedChar, inline, inlines1, math } from './inlines.js';
import { rawHtmlInline } from './raw-html.js';
import { rawLaTeXInlinePrime } from './raw-tex.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../parsing/tables.js').RawRow} RawRow */
/** @typedef {import('../parsing/tables.js').Header} Header */

// A space, tab, carriage return or line feed: what Pandoc's `trim` drops.
const isWS = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';

// `text` from `start` to `end`, what `trim` drops at either end left out.
function trimmed(text, start, end) {
  while (start < end && isWS(text[start])) start++;
  while (end > start && isWS(text[end - 1])) end--;
  return [start, end];
}

// `source` with what `trim` drops at either end left out.
const trimSource = (source) =>
  source.cut(...trimmed(source.text, 0, source.text.length));

const spaceChars = many(spaceChar);

/**
 * Dashes and the spaces after them: how many dashes, and how many of both.
 *
 * @see Text.Pandoc.Readers.Markdown.dashedLine
 * @type {import('../core.js').Parser<[number, number]>}
 */
const dashedLine = (ctx) => {
  const from = ctx.pos;
  while (ctx.text[ctx.pos] === '-') ctx.pos++;
  const dashes = ctx.pos - from;
  if (dashes === 0) return FAIL;
  spaceChars(ctx);
  return [dashes, ctx.pos - from];
};
const dashedLines = many1(dashedLine);

/**
 * Where columns of the dashes end, by display width: from the
 * indentation's, each dashed line and its spaces after the one before.
 *
 * @param {number} indent
 * @param {[number, number][]} dashes
 */
function indicesOf(indent, dashes) {
  const indices = [indent];
  for (const [, width] of dashes) indices.push(indices.at(-1) + width);
  return indices;
}

/**
 * The columns of `line`, split at `indices` but the last, the piece before
 * the first left out: each one's span in the line.
 *
 * @param {string} line
 * @param {number[]} indices
 * @returns {[number, number][]}
 */
const columnSpans = (line, indices) =>
  splitTextByIndices(indices.slice(0, -1), line).slice(1);

/**
 * The cells of the line at `from`: each one's span in `text`, trimmed.
 *
 * @param {string} text
 * @param {number} from
 * @param {string} line
 * @param {number[]} indices
 * @returns {[number, number][]}
 */
const cellSpans = (text, from, line, indices) =>
  columnSpans(line, indices).map(([start, end]) =>
    trimmed(text, from + start, from + end),
  );

// The text of each column of `line`, as written.
const columnTexts = (line, indices) =>
  columnSpans(line, indices).map(([start, end]) => line.slice(start, end));

/**
 * A column's alignment from its header's lines and its dashes' length:
 * by its shortest line, right where it starts with a space, left where it
 * is shorter than the dashes, centered where both, else the default.
 *
 * @see Text.Pandoc.Readers.Markdown.alignType
 * @param {string[]} lines
 * @param {number} length
 */
function alignType(lines, length) {
  const nonempty = lines
    .map((l) => l.replace(/[ \t\r\n]+$/, ''))
    .filter(Boolean);
  if (nonempty.length === 0) return AlignDefault;
  const codePoints = (s) => [...s].length;
  const shortest = nonempty.reduce((a, b) =>
    codePoints(b) < codePoints(a) ? b : a,
  );
  const left = shortest[0] === ' ' || shortest[0] === '\t';
  const right = realLength(shortest) < length;
  if (left) return right ? AlignCenter : AlignRight;
  return right ? AlignLeft : AlignDefault;
}

const plains = many((ctx) => plain(ctx));

// A cell's text read again as plain blocks.
function cellBlocks(ctx, source) {
  const read = parseFromStringFresh(ctx, plains, source);
  return read === FAIL ? FAIL : read.flat();
}

// Each of `sources` read as a cell; `FAIL` where one fails.
function cellsOf(ctx, sources) {
  const cells = [];
  for (const source of sources) {
    const blocks = cellBlocks(ctx, source);
    if (blocks === FAIL) return FAIL;
    cells.push(blocks);
  }
  return cells;
}

const slices = (text, spans) =>
  spans.map(([start, end]) => SourceText.slice(text, start, end));

// A line read whole, where it starts and its text; nothing read.
function peekLine(ctx) {
  const from = ctx.pos;
  const line = anyLine(ctx);
  ctx.pos = from;
  return line === FAIL ? FAIL : { from, line };
}

// A line read, where it starts and its text.
function readLine(ctx) {
  const from = ctx.pos;
  const line = anyLine(ctx);
  return line === FAIL ? FAIL : { from, line };
}

/**
 * A simple table's header: a line of text unless `headless`, then dashed
 * lines. A headless table aligns its columns by its first row.
 *
 * @see Text.Pandoc.Readers.Markdown.simpleTableHeader
 * @param {boolean} headless
 * @returns {import('../core.js').Parser<Header>}
 */
function simpleTableHeader(headless) {
  return attempt((ctx) => {
    const content = headless ? null : readLine(ctx);
    if (content === FAIL) return FAIL;
    const indent = skipNonindentSpaces(ctx);
    if (indent === FAIL) return FAIL;
    const dashes = dashedLines(ctx);
    if (dashes === FAIL || newline(ctx) === FAIL) return FAIL;
    const indices = indicesOf(indent, dashes);
    const source = content ?? peekLine(ctx);
    if (source === FAIL) return FAIL;
    const aligns = columnTexts(source.line, indices).map((column, i) =>
      alignType([column], dashes[i][0]),
    );
    if (headless) return { heads: [], aligns, indices };
    const { text } = ctx;
    const trimmedSpans = cellSpans(text, source.from, source.line, indices);
    const cells = cellsOf(ctx, slices(text, trimmedSpans));
    if (cells === FAIL) return FAIL;
    const end = source.from + source.line.length;
    return { heads: [{ cells, start: source.from, end }], aligns, indices };
  });
}

const closerAhead = lookAhead(divFenceEnd);

/**
 * Blank lines, or none before an open div's closing fence.
 *
 * @see Text.Pandoc.Readers.Markdown.blanklines'
 */
const blanklinesOrCloser = alt(blanklines, (ctx) =>
  inDiv(ctx) ? closerAhead(ctx) : FAIL,
);

/**
 * A table's last line: dashed lines, then blank lines.
 *
 * @see Text.Pandoc.Readers.Markdown.tableFooter
 */
const tableFooter = attempt((ctx) =>
  skipNonindentSpaces(ctx) === FAIL || dashedLines(ctx) === FAIL
    ? FAIL
    : blanklinesOrCloser(ctx),
);

/**
 * A multiline table's dashed line above its header.
 *
 * @see Text.Pandoc.Readers.Markdown.tableSep
 */
const tableSep = attempt((ctx) =>
  skipNonindentSpaces(ctx) === FAIL || dashedLines(ctx) === FAIL
    ? FAIL
    : newline(ctx),
);

// Pandoc's `notFollowedBy'`: a closer ahead reads nothing, yet ends the rows.
const noRowEnd = notAhead(alt(blanklinesOrCloser, tableFooter));

/**
 * A row's line: where it starts, its text, and its cells' trimmed spans.
 *
 * @see Text.Pandoc.Readers.Markdown.rawTableLine
 * @param {Context} ctx
 * @param {number[]} indices
 */
function rawTableLine(ctx, indices) {
  if (noRowEnd(ctx) === FAIL) return FAIL;
  const read = readLine(ctx);
  if (read === FAIL) return FAIL;
  return { ...read, spans: cellSpans(ctx.text, read.from, read.line, indices) };
}

/**
 * A simple table's row: one line.
 *
 * @see Text.Pandoc.Readers.Markdown.tableLine
 * @param {number[]} indices
 * @returns {import('../core.js').Parser<RawRow>}
 */
const tableLine = (indices) => (ctx) => {
  const raw = rawTableLine(ctx, indices);
  if (raw === FAIL) return FAIL;
  const cells = cellsOf(ctx, slices(ctx.text, raw.spans));
  if (cells === FAIL) return FAIL;
  return { cells, start: raw.from, end: raw.from + raw.line.length };
};

/**
 * Each column of `lines`' cells as one text: the cells, each line's newline
 * after it standing for the line break, at the cell's end.
 *
 * @param {string} text
 * @param {{spans: [number, number][]}[]} lines
 */
function columns(text, lines) {
  return lines[0].spans.map((_, k) =>
    SourceText.concat(
      lines.flatMap(({ spans }) => {
        const [start, end] = spans[k];
        return [
          SourceText.slice(text, start, end),
          SourceText.synth('\n', end, end),
        ];
      }),
    ),
  );
}

/**
 * A multiline table's row: lines up to a blank line, each column of their
 * cells one cell.
 *
 * @see Text.Pandoc.Readers.Markdown.multilineRow
 * @param {number[]} indices
 * @returns {import('../core.js').Parser<RawRow>}
 */
const multilineRow = (indices) => {
  const rowLines = many1((ctx) => rawTableLine(ctx, indices));
  return (ctx) => {
    const lines = rowLines(ctx);
    if (lines === FAIL) return FAIL;
    const cells = cellsOf(ctx, columns(ctx.text, lines));
    if (cells === FAIL) return FAIL;
    const last = lines.at(-1);
    return { cells, start: lines[0].from, end: last.from + last.line.length };
  };
};

const notBlankline = notFollowedBy(blankline);
const notTableSep = notFollowedBy(tableSep);
const headerLines = many1((ctx) =>
  notTableSep(ctx) === FAIL ? FAIL : readLine(ctx),
);

/**
 * A multiline table's header: unless `headless`, a dashed line, then lines
 * of text; then dashed lines. Its last column runs a space further, the
 * space between columns the others count.
 *
 * @see Text.Pandoc.Readers.Markdown.multilineTableHeader
 * @param {boolean} headless
 * @returns {import('../core.js').Parser<Header>}
 */
function multilineTableHeader(headless) {
  return attempt((ctx) => {
    if (!headless && (tableSep(ctx) === FAIL || notBlankline(ctx) === FAIL)) {
      return FAIL;
    }
    const content = headless ? [] : headerLines(ctx);
    if (content === FAIL) return FAIL;
    const indent = skipNonindentSpaces(ctx);
    if (indent === FAIL) return FAIL;
    const dashes = dashedLines(ctx);
    if (dashes === FAIL || newline(ctx) === FAIL) return FAIL;
    const indices = indicesOf(indent, dashes);
    indices[indices.length - 1]++;
    const lines = headless ? [peekLine(ctx)] : content;
    if (lines[0] === FAIL) return FAIL;
    const split = lines.map(({ line }) => columnTexts(line, indices));
    const aligns = dashes.map(([length], k) =>
      alignType(
        split.map((pieces) => pieces[k]),
        length,
      ),
    );
    if (headless) return { heads: [], aligns, indices };
    const { text } = ctx;
    const withSpans = content.map((l) => ({
      spans: cellSpans(text, l.from, l.line, indices),
    }));
    const cells = cellsOf(ctx, columns(text, withSpans).map(trimSource));
    if (cells === FAIL) return FAIL;
    const last = content.at(-1);
    const end = last.from + last.line.length;
    return { heads: [{ cells, start: content[0].from, end }], aligns, indices };
  });
}

// Rows of a simple table follow one another, nothing between them.
const nothing = () => undefined;

/**
 * @see Text.Pandoc.Readers.Markdown.simpleTable
 * @param {boolean} headless
 */
const simpleTable = (headless) => {
  const footer = headless ? tableFooter : alt(tableFooter, blanklinesOrCloser);
  const parse = tableWith(
    simpleTableHeader(headless),
    tableLine,
    nothing,
    footer,
  );
  return (ctx) => {
    const components = parse(ctx);
    return components === FAIL ? FAIL : withDefaultWidths(components);
  };
};

/**
 * @see Text.Pandoc.Readers.Markdown.multilineTable
 * @param {boolean} headless
 */
const multilineTable = (headless) =>
  tableWith(
    multilineTableHeader(headless),
    multilineRow,
    blanklines,
    tableFooter,
  );

// A pipe or plus between header parts, no blank line after it.
// @see Text.Pandoc.Readers.Markdown.sepPipe
const sepPipe = attempt((ctx) => {
  if (alt(char('|'), char('+'))(ctx) === FAIL) return FAIL;
  return notFollowedBy(blankline)(ctx);
});

const pipe = char('|');
const openOrClose = option(false, (ctx) => (pipe(ctx) === FAIL ? FAIL : true));
const colonMark = option(false, (ctx) =>
  char(':')(ctx) === FAIL ? FAIL : true,
);
const dashes = many1(char('-'));

/**
 * A header part: dashes, colons marking its alignment; and its length.
 *
 * @see Text.Pandoc.Readers.Markdown.pipeTableHeaderPart
 * @type {import('../core.js').Parser<[{t: string}, number]>}
 */
const pipeTableHeaderPart = attempt((ctx) => {
  if (spaceChars(ctx) === FAIL) return FAIL;
  const left = colonMark(ctx);
  const ds = dashes(ctx);
  if (ds === FAIL) return FAIL;
  const right = colonMark(ctx);
  if (spaceChars(ctx) === FAIL) return FAIL;
  const len = ds.length + (left ? 1 : 0) + (right ? 1 : 0);
  const align =
    left && right
      ? AlignCenter
      : left
        ? AlignLeft
        : right
          ? AlignRight
          : AlignDefault;
  return [align, len];
});
const moreHeaderParts = many((ctx) =>
  sepPipe(ctx) === FAIL ? FAIL : pipeTableHeaderPart(ctx),
);

/**
 * The line under a pipe table's header: each column's alignment and the
 * length of its dashes.
 *
 * @see Text.Pandoc.Readers.Markdown.pipeBreak
 * @type {import('../core.js').Parser<[{t: string}[], number[]]>}
 */
const pipeBreak = attempt((ctx) => {
  if (skipNonindentSpaces(ctx) === FAIL) return FAIL;
  const openPipe = openOrClose(ctx);
  const first = pipeTableHeaderPart(ctx);
  if (first === FAIL) return FAIL;
  const rest = moreHeaderParts(ctx);
  if (rest === FAIL) return FAIL;
  const closePipe = openOrClose(ctx);
  // at least one pipe needed for a one-column table:
  if (rest.length === 0 && !(openPipe || closePipe)) return FAIL;
  if (blankline(ctx) === FAIL) return FAIL;
  const parts = [first, ...rest];
  return [parts.map(([a]) => a), parts.map(([, n]) => n)];
});

const chunk = alt(
  (ctx) => code(ctx),
  (ctx) => math(ctx),
  (ctx) => rawHtmlInline(ctx),
  (ctx) => escapedChar(ctx),
  (ctx) => rawLaTeXInlinePrime(ctx),
  noneOf('|\n\r'),
);
const cellText = (ctx) => {
  const start = ctx.pos;
  return many(chunk)(ctx) === FAIL ? FAIL : [start, ctx.pos];
};
const cellTexts = sepBy1(cellText, pipe);

/**
 * A pipe table's row: its cells' spans, as written; its line's.
 *
 * @see Text.Pandoc.Readers.Markdown.pipeTableRow
 * @type {import('../core.js').Parser<{cells: [number, number][], start: number, end: number}>}
 */
const pipeTableRow = attempt((ctx) => {
  if (scanForPipe(ctx) === FAIL) return FAIL;
  const start = ctx.pos;
  if (spaceChars(ctx) === FAIL) return FAIL;
  const openPipe = openOrClose(ctx);
  const cells = cellTexts(ctx);
  if (cells === FAIL) return FAIL;
  const closePipe = openOrClose(ctx);
  // at least one pipe needed for a one-column table:
  if (cells.length === 1 && !(openPipe || closePipe)) return FAIL;
  const end = ctx.pos;
  if (blankline(ctx) === FAIL) return FAIL;
  return { cells, start, end };
});
const pipeTableRows = many(pipeTableRow);

/**
 * A cell's inlines as plain text; nothing for none.
 *
 * @see Text.Pandoc.Readers.Markdown.pipeTableCell
 * @param {Context} ctx
 */
function pipeTableCell(ctx) {
  const ils = inlines1(ctx);
  if (ils === FAIL) return [];
  return B.plain(ils, ils[0]?.start, ils.at(-1)?.end);
}

/**
 * Whether the line holds a pipe before it ends.
 *
 * @see Text.Pandoc.Readers.Markdown.scanForPipe
 * @param {Context} ctx
 */
function scanForPipe(ctx) {
  for (let i = ctx.pos; i < ctx.text.length; i++) {
    const c = ctx.text[i];
    if (c === '|') return undefined;
    if (c === '\n') return FAIL;
  }
  return FAIL;
}

/**
 * A pipe table: a header row, the line of dashes under it, and rows; its
 * columns' widths those of the dashes where a line is wider than the text.
 *
 * @see Text.Pandoc.Readers.Markdown.pipeTable
 * @type {import('../core.js').Parser<import('../parsing/tables.js').TableComponents>}
 */
const pipeTable = attempt((ctx) => {
  if (skipNonindentSpaces(ctx) === FAIL) return FAIL;
  if (lookAhead(nonspaceChar)(ctx) === FAIL) return FAIL;
  const heads = pipeTableRow(ctx);
  if (heads === FAIL) return FAIL;
  const brk = pipeBreak(ctx);
  if (brk === FAIL) return FAIL;
  const [aligns, seplengths] = brk;
  const numcols = aligns.length;
  const lines = pipeTableRows(ctx);
  if (lines === FAIL) return FAIL;
  const rows = [heads, ...lines].map((r) => ({
    ...r,
    cells: r.cells.slice(0, numcols),
  }));
  const text = ctx.text;
  const lineWidths = rows.map((r) =>
    r.cells.reduce((sum, [s, e]) => sum + realLength(text.slice(s, e)), 0),
  );
  const total = seplengths.reduce((sum, n) => sum + n, 0);
  // add numcols + 1 for the pipes themselves
  const wide =
    Math.max(total, ...lineWidths) + (numcols + 1) > ctx.state.options.columns;
  const widths = wide ? seplengths.map((n) => n / total) : aligns.map(() => 0);
  const cellContents = ([s, e]) => {
    const [from, to] = trimmed(text, s, e);
    return parseFromStringFresh(
      ctx,
      pipeTableCell,
      SourceText.slice(text, from, to),
    );
  };
  const parsed = [];
  for (const r of rows) {
    const cells = [];
    for (const span of r.cells) {
      const bs = cellContents(span);
      if (bs === FAIL) return FAIL;
      cells.push(bs);
    }
    parsed.push({ cells, start: r.start, end: r.end });
  }
  const [head, ...body] = parsed;
  return toTableComponents(aligns, widths, [head], body);
});

const colon = char(':');
const notPunctuation = notFollowedBy(satisfy((c) => /^\p{P}$/u.test(c)));
const initial = oneOf('Tt');
const able = string('able:');
const captionStart = alt(
  (ctx) => (colon(ctx) === FAIL ? FAIL : notPunctuation(ctx)),
  (ctx) => (initial(ctx) === FAIL ? FAIL : able(ctx)),
);
const tableAttributes = whenEnabled('table_attributes', attributes);
const attributesEnd = notFollowedBy(
  attempt((ctx) => (tableAttributes(ctx) === FAIL ? FAIL : blanklines(ctx))),
);
const captionInlines = many((ctx) =>
  attributesEnd(ctx) === FAIL ? FAIL : inline(ctx),
);
const captionAttr = option(nullAttr, tableAttributes);

/**
 * A caption: `:` or `Table:`, then inlines, attributes after them, and
 * blank lines.
 *
 * @see Text.Pandoc.Readers.Markdown.tableCaption
 * @type {import('../core.js').Parser<{inlines: import('../ast/builder.js').Inlines, attr: unknown}>}
 */
const tableCaption = whenEnabled(
  'table_captions',
  attempt((ctx) => {
    if (skipNonindentSpaces(ctx) === FAIL || captionStart(ctx) === FAIL) {
      return FAIL;
    }
    const read = captionInlines(ctx);
    if (read === FAIL) return FAIL;
    const attr = captionAttr(ctx);
    if (attr === FAIL || blanklines(ctx) === FAIL) return FAIL;
    return { inlines: B.trimInlines(B.concat(read)), attr };
  }),
);

const maybeCaption = option(null, tableCaption);

const gridTableAt = gridTableWith((ctx) => parseBlocks(ctx));
// An indented grid table's lines, each from its `+` or `|`: by indent.
const gridLinesByIndent = new Map();
function gridLines(indent) {
  let lines = gridLinesByIndent.get(indent);
  if (lines === undefined) {
    lines = many1(
      attempt((ctx) => {
        if (gobbleSpaces(ctx, indent) === FAIL) return FAIL;
        const start = ctx.pos;
        const c = ctx.text[start];
        if ((c !== '+' && c !== '|') || anyLine(ctx) === FAIL) return FAIL;
        return SourceText.slice(ctx.text, start, ctx.pos);
      }),
    );
    gridLinesByIndent.set(indent, lines);
  }
  return lines;
}

/**
 * A grid table, its indentation of up to a tab stop less one stripped from
 * every line first, where it has some.
 *
 * @see Text.Pandoc.Readers.Markdown.gridTable
 */
const gridTable = attempt((ctx) => {
  const { pos } = ctx;
  const indent = skipNonindentSpaces(ctx);
  ctx.pos = pos;
  if (indent === FAIL) return FAIL;
  if (indent === 0) return gridTableAt(ctx);
  const lines = gridLines(indent)(ctx);
  if (lines === FAIL) return FAIL;
  return parseFromStringFresh(ctx, gridTableAt, SourceText.concat(lines));
});

const tableKinds = alt(
  whenEnabled(
    'pipe_tables',
    attempt((ctx) => (scanForPipe(ctx) === FAIL ? FAIL : pipeTable(ctx))),
  ),
  whenEnabled('multiline_tables', multilineTable(false)),
  whenEnabled('simple_tables', alt(simpleTable(true), simpleTable(false))),
  whenEnabled('multiline_tables', multilineTable(true)),
  whenEnabled('grid_tables', gridTable),
);

/**
 * A table, a caption before it or after it.
 *
 * @see Text.Pandoc.Readers.Markdown.table
 * @param {Context} ctx
 */
export function table(ctx) {
  return tableAt(ctx);
}

const tableAt = attempt((ctx) => {
  const start = ctx.pos;
  const front = maybeCaption(ctx);
  if (front === FAIL) return FAIL;
  const parts = tableKinds(ctx);
  if (parts === FAIL || optionalBlanklines(ctx) === FAIL) return FAIL;
  const caption = front ?? maybeCaption(ctx);
  if (caption === FAIL) return FAIL;
  const ils = caption?.inlines ?? [];
  const captionBlocks = B.plain(ils, ils[0]?.start, ils.at(-1)?.end);
  const { specs, head, bodies, foot } = parts;
  const end = blockEnd(ctx.text, start, ctx.pos, []);
  return B.tableWith(
    caption?.attr ?? nullAttr,
    B.simpleCaption(captionBlocks),
    specs,
    head,
    bodies,
    foot,
    start,
    end,
  );
});
