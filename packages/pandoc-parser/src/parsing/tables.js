// A table's parts as Pandoc's table parsers build them: its column specs,
// head, bodies and foot, from a header, rows and a footer.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.GridTable`. A parsed row
// is its cells' blocks and the span of its lines.

import * as B from '../ast/builder.js';
import {
  AlignDefault,
  ColWidthDefault,
  colWidth,
  nullAttr,
  Row,
} from '../ast/nodes.js';
import { attempt, FAIL, sepEndBy1 } from '../core.js';

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
