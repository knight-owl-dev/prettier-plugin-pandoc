// A table's parts as Pandoc's table parsers build them: its column specs,
// head, bodies and foot, from a header, rows and a footer.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.GridTable`. A parsed row
// is its cells' blocks and the span of its lines.

import * as B from '../ast/builder.js';
import {
  AlignCenter,
  AlignDefault,
  AlignLeft,
  AlignRight,
  ColWidthDefault,
  colWidth,
  nullAttr,
  Row,
} from '../ast/nodes.js';
import { isSpace } from '../char.js';
import { attempt, FAIL, sepEndBy1 } from '../core.js';
import { gridTable, rows } from '../gridtables/grid-table.js';
import { SourceText } from '../source-text.js';
import { optionalBlanklines, parseFromStringFresh } from './general.js';

/** @typedef {import('../core.js').Context} Context */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */
/** @typedef {import('../ast/builder.js').Blocks} Blocks */
/** @typedef {{cells: Blocks[], start: number, end: number}} RawRow */

/**
 * A table's header: its rows, each column's alignment, and the display
 * widths its columns end at.
 *
 * @typedef {{heads: RawRow[], aligns: {t: string}[], indices: number[]}} Header
 */

/**
 * A table's parts, caption and attributes aside.
 *
 * @see Text.Pandoc.Parsing.GridTable.TableComponents
 * @typedef {object} TableComponents
 * @property {unknown[]} specs
 * @property {[unknown, Row[]]} head
 * @property {[unknown, number, Row[], Row[]][]} bodies
 * @property {[unknown, Row[]]} foot
 */

/**
 * A table: its header, then rows `row` reads, `separator` between them and
 * after the last, then its footer. A header row of empty cells alone is no
 * header.
 *
 * @see Text.Pandoc.Parsing.GridTable.tableWith'
 * @param {Parser<Header>} header
 * @param {(indices: number[]) => Parser<RawRow>} row
 * @param {Parser<unknown>} separator
 * @param {Parser<unknown>} footer
 * @returns {Parser<TableComponents>}
 */
export function tableWith(header, row, separator, footer) {
  return attempt((ctx) => {
    const parsed = header(ctx);
    if (parsed === FAIL) return FAIL;
    const { heads, aligns, indices } = parsed;
    const rows = sepEndBy1(row(indices), separator)(ctx);
    if (rows === FAIL || footer(ctx) === FAIL) return FAIL;
    const widths =
      indices.length === 0
        ? aligns.map(() => 0)
        : widthsFromIndices(ctx.state.options.columns, indices);
    return toTableComponents(aligns, widths, heads, rows);
  });
}

/**
 * A table's parts from its columns' alignments and widths, its header rows
 * and its rows, a header row of empty cells left out.
 *
 * @see Text.Pandoc.Parsing.GridTable.toTableComponents'
 * @param {{t: string}[]} aligns
 * @param {number[]} widths
 * @param {RawRow[]} heads
 * @param {RawRow[]} rows
 * @returns {TableComponents}
 */
function toTableComponents(aligns, widths, heads, rows) {
  const headRows = heads.filter((h) => h.cells.some((c) => c.length > 0));
  return {
    specs: toColSpecs(aligns, widths),
    head: [nullAttr, headRows.map(toRow)],
    bodies: [[nullAttr, 0, [], rows.map(toRow)]],
    foot: [nullAttr, []],
  };
}

/** @see Text.Pandoc.Parsing.GridTable.toRow */
const toRow = ({ cells, start, end }) =>
  new Row(
    nullAttr,
    cells.map((blocks) => B.cell(AlignDefault, 1, 1, blocks)),
    start,
    end,
  );

/**
 * Each column's alignment and width, the widths scaled to sum to 1 where
 * they sum to more; a width of 0 the default.
 *
 * @see Text.Pandoc.Parsing.GridTable.toColSpecs
 * @param {{t: string}[]} aligns
 * @param {number[]} widths
 */
function toColSpecs(aligns, widths) {
  const total = widths.reduce((sum, w) => sum + w, 0);
  return aligns.map((align, i) => {
    const w = total < 1 ? widths[i] : widths[i] / total;
    return [align, w > 0 ? colWidth(w) : ColWidthDefault];
  });
}

/**
 * Each column's width, a fraction of the text's `columns` or of the
 * table's, the wider: from the display widths its columns end at, the
 * first the indentation's. The last column is as wide as the one before
 * where it is up to 2 narrower: the space between columns, which every
 * other column counts.
 *
 * @see Text.Pandoc.Parsing.GridTable.widthsFromIndices
 * @param {number} columns
 * @param {number[]} indices
 */
export function widthsFromIndices(columns, indices) {
  if (indices.length === 0) return [];
  const textWidth = Math.max(columns, indices.at(-1));
  const lengths = indices.map((index, i) => index - (indices[i - 1] ?? 0));
  const n = lengths.length;
  if (n >= 2 && lengths[n - 1] < lengths[n - 2]) {
    if (lengths[n - 2] - lengths[n - 1] <= 2) lengths[n - 1] = lengths[n - 2];
  }
  const total = lengths.reduce((sum, l) => sum + l, 0);
  const quotient = total > textWidth ? total : textWidth;
  return lengths.slice(1).map((l) => l / quotient);
}

/**
 * Components with every column's width the default.
 *
 * @param {TableComponents} components
 * @returns {TableComponents}
 */
export const withDefaultWidths = (components) => ({
  ...components,
  specs: components.specs.map(([align]) => [align, ColWidthDefault]),
});

// What `isSpace` drops from a line's end: a cell line's text and offsets.
function stripEnd({ text, offsets }) {
  let end = text.length;
  while (end > 0 && isSpace(text[end - 1])) end--;
  return { text: text.slice(0, end), offsets: offsets.slice(0, end) };
}

/**
 * A cell's lines without a leading space where every one has one.
 *
 * @see Text.Pandoc.Parsing.GridTable.removeOneLeadingSpace
 */
function removeOneLeadingSpace(lines) {
  const spaced = lines.every(({ text }) => text === '' || text[0] === ' ');
  if (!spaced) return lines;
  return lines.map(({ text, offsets }) => ({
    text: text.slice(1),
    offsets: offsets.slice(1),
  }));
}

/**
 * A cell's text: its lines, ends stripped, a common leading space dropped,
 * each ended by a newline, and one more. Runs of characters written one
 * after another are copied; a character written nowhere, and each
 * newline, stands where the text before it ended.
 *
 * @param {string} source
 * @param {import('../gridtables/grid-table.js').CellLine[]} lines
 */
function cellSource(source, lines) {
  const parts = [];
  let at = lines.flatMap((l) => l.offsets).find((o) => o >= 0) ?? 0;
  for (const { text, offsets } of removeOneLeadingSpace(lines.map(stripEnd))) {
    for (let k = 0; k < text.length; ) {
      if (offsets[k] < 0) {
        parts.push(SourceText.synth(text[k], at, at));
        k++;
        continue;
      }
      let end = k + 1;
      while (end < text.length && offsets[end] === offsets[end - 1] + 1) end++;
      at = offsets[end - 1] + 1;
      parts.push(SourceText.slice(source, offsets[k], at));
      k = end;
    }
    parts.push(SourceText.synth('\n', at, at));
  }
  parts.push(SourceText.synth('\n', at, at));
  return SourceText.concat(parts);
}

/**
 * A single paragraph as a plain block.
 *
 * @see Text.Pandoc.Parsing.GridTable.plainify
 * @param {Blocks} blocks
 */
const plainify = (blocks) =>
  blocks.length === 1 && blocks[0].t === 'Para'
    ? B.plain(blocks[0].c, blocks[0].start, blocks[0].end)
    : blocks;

/**
 * Each column's width, its separator counted, a fraction of the table's
 * width or of the text's `columns`, the wider.
 *
 * @see Text.Pandoc.Parsing.GridTable.fractionalColumnWidths
 * @param {[string, number][]} colSpecs
 * @param {number} columns
 */
function fractionalColumnWidths(colSpecs, columns) {
  const widths = colSpecs.map(([, w]) => w + 1);
  const total = widths.reduce((sum, w) => sum + w, 0);
  const norm = Math.max(total + widths.length - 2, columns);
  return widths.map((w) => w / norm);
}

const ALIGNMENTS = { AlignDefault, AlignLeft, AlignRight, AlignCenter };

// A cell of nothing: what a header of only such cells is none of.
const isEmptyCell = ([attr, align, rowSpan, colSpan, blocks]) =>
  attr === nullAttr &&
  align === AlignDefault &&
  rowSpan === 1 &&
  colSpan === 1 &&
  blocks.length === 0;

/**
 * A grid table's parts: each cell's lines read as blocks by `blocks`, a
 * single paragraph plain; rows split into head, body and foot at the part
 * separators. A head of one row of empty cells is none.
 *
 * @see Text.Pandoc.Parsing.GridTable.gridTableWith'
 * @param {Parser<Blocks>} blocks
 * @returns {Parser<TableComponents>}
 */
export function gridTableWith(blocks) {
  return (ctx) => {
    const found = gridTable(ctx.text, ctx.pos);
    if (found === null) return FAIL;
    ctx.pos = found.end;
    optionalBlanklines(ctx);
    const { table, lines } = found;
    const rowList = [];
    for (const [r, row] of rows(table).entries()) {
      const cells = [];
      for (const { content, rowSpan, colSpan } of row) {
        const read = parseFromStringFresh(
          ctx,
          blocks,
          cellSource(ctx.text, content),
        );
        if (read === FAIL) return FAIL;
        cells.push(B.cell(AlignDefault, rowSpan, colSpan, plainify(read)));
      }
      const [top, bottom] = [table.rowSeps[r], table.rowSeps[r + 1]];
      rowList.push(new Row(nullAttr, cells, ...rowSpan(lines, top, bottom)));
    }
    const widths = fractionalColumnWidths(
      table.colSpecs,
      ctx.state.options.columns,
    );
    const specs = table.colSpecs.map(([align], k) => [
      ALIGNMENTS[align],
      colWidth(widths[k]),
    ]);
    const headLen = table.head ?? 0;
    const headRows = rowList.slice(0, headLen);
    let bodyRows = rowList.slice(headLen);
    let footRows = [];
    if (table.foot !== null) {
      const split = table.foot - headLen - 1;
      [bodyRows, footRows] = [bodyRows.slice(0, split), bodyRows.slice(split)];
    }
    const emptyHead =
      headRows.length === 1 &&
      (headRows[0].cells.length === 0 || headRows[0].cells.every(isEmptyCell));
    return {
      specs,
      head: [nullAttr, emptyHead ? [] : headRows],
      bodies: [[nullAttr, 0, [], bodyRows]],
      foot: [nullAttr, footRows],
    };
  };
}

// A row's span: its lines between its borders, character rows `top` and
// `bottom` from 1; at its bottom border where it has none.
function rowSpan(lines, top, bottom) {
  if (bottom - top < 2) return [lines[bottom - 1].at, lines[bottom - 1].at];
  const last = lines[bottom - 2];
  return [lines[top].at, last.at + last.text.length];
}
