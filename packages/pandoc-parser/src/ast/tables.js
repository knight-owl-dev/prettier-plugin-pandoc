// Tables as pandoc-types' builder makes them: each section normalized to the
// table's width, so that its cells fill a grid, none overlapping another
// or reaching past the grid.
//
// Ported from pandoc-types 1.23.1.2's `Text.Pandoc.Builder`. A cell is
// Pandoc's `[attr, alignment, rowSpan, colSpan, blocks]`.

import { AlignDefault, Node, nullAttr, Row } from './nodes.js';

/** @typedef {import('./builder.js').Blocks} Blocks */
/** @typedef {[unknown, {t: string}, number, number, Blocks]} Cell */

/**
 * @see Text.Pandoc.Builder.cell
 * @param {{t: string}} align
 * @param {number} rowSpan
 * @param {number} colSpan
 * @param {Blocks} blocks
 * @returns {Cell}
 */
export const cell = (align, rowSpan, colSpan, blocks) => [
  nullAttr,
  align,
  rowSpan,
  colSpan,
  blocks,
];

/** @see Text.Pandoc.Builder.emptyCell */
const emptyCell = Object.freeze(cell(AlignDefault, 1, 1, Object.freeze([])));

/**
 * A table, its head, bodies and foot normalized to as many columns as
 * `specs` gives.
 *
 * @see Text.Pandoc.Builder.tableWith
 * @param {unknown} attr
 * @param {unknown} caption
 * @param {unknown[]} specs
 * @param {[unknown, Row[]]} head
 * @param {[unknown, number, Row[], Row[]][]} bodies
 * @param {[unknown, Row[]]} foot
 * @param {number} start
 * @param {number} end
 */
export function tableWith(
  attr,
  caption,
  specs,
  head,
  bodies,
  foot,
  start,
  end,
) {
  const width = specs.length;
  const content = [
    attr,
    caption,
    specs,
    [head[0], headerSection(width, head[1])],
    bodies.map((body) => tableBody(width, body)),
    [foot[0], headerSection(width, foot[1])],
  ];
  return [new Node('Table', content, start, end)];
}

/**
 * A body, its row head no wider than the table and its row head cells
 * within it.
 *
 * @see Text.Pandoc.Builder.normalizeTableBody
 * @param {number} width
 * @param {[unknown, number, Row[], Row[]]} body
 */
function tableBody(width, [attr, rowHead, head, rows]) {
  const headWidth = Math.max(0, Math.min(width, rowHead));
  return [
    attr,
    headWidth,
    headerSection(width, head),
    bodySection(width, headWidth, rows),
  ];
}

/**
 * Rows laid on a grid `width` wide, one after another.
 *
 * @see Text.Pandoc.Builder.normalizeHeaderSection
 * @param {number} width
 * @param {Row[]} rows
 */
function headerSection(width, rows) {
  let hang = Array(width).fill(1);
  return clipRows(rows).map((row) => {
    const placed = placeRowSection(hang, row.cells, 0);
    hang = placed.hang;
    return new Row(row.attr, placed.cells, row.start, row.end);
  });
}

/**
 * Rows laid on a grid `width` wide, their first cells on its first
 * `headWidth` columns, the rest on the others.
 *
 * @see Text.Pandoc.Builder.normalizeBodySection
 * @param {number} width
 * @param {number} headWidth
 * @param {Row[]} rows
 */
function bodySection(width, headWidth, rows) {
  let headHang = Array(headWidth).fill(1);
  let bodyHang = Array(width - headWidth).fill(1);
  return clipRows(rows).map((row) => {
    const head = placeRowSection(headHang, row.cells, 0);
    const body = placeRowSection(bodyHang, row.cells, head.next);
    [headHang, bodyHang] = [head.hang, body.hang];
    return new Row(
      row.attr,
      [...head.cells, ...body.cells],
      row.start,
      row.end,
    );
  });
}

/**
 * Cells from `cells[next]` on, empty cells after the last, laid in order on
 * a grid row whose columns the row above still covers by `hang`: each at
 * the first free column, narrowed so it overlaps none, until the row is
 * full. The row's own hang, its cells, and the index of the next cell.
 *
 * @see Text.Pandoc.Builder.placeRowSection
 * @param {number[]} oldHang How many rows each column's cell above spans,
 *   that row included.
 * @param {Cell[]} cells
 * @param {number} next
 * @returns {{hang: number[], cells: Cell[], next: number}}
 */
function placeRowSection(oldHang, cells, next) {
  const hang = [];
  const placed = [];
  let column = 0;
  while (column < oldHang.length) {
    if (oldHang[column] > 1) {
      hang.push(oldHang[column] - 1);
      column++;
      continue;
    }
    const c = cells[next] ?? emptyCell;
    const [, , rowSpan, colSpan] = c;
    const wanted = Math.max(1, colSpan);
    let free = 0;
    while (free < wanted && oldHang[column + free] === 1) free++;
    placed.push(c[3] === free ? c : withColSpan(c, free));
    for (let k = 0; k < free; k++) hang.push(rowSpan);
    column += free;
    next++;
  }
  return { hang, cells: placed, next };
}

const withColSpan = ([attr, align, rowSpan, , blocks], colSpan) => [
  attr,
  align,
  rowSpan,
  colSpan,
  blocks,
];

/**
 * Rows with each cell's row span between 1 and the rows left from its own.
 *
 * @see Text.Pandoc.Builder.clipRows
 * @param {Row[]} rows
 */
function clipRows(rows) {
  return rows.map((row, i) => {
    const high = rows.length - i;
    const cells = row.cells.map((c) => {
      const rowSpan = Math.min(high, Math.max(1, c[2]));
      return rowSpan === c[2] ? c : [c[0], c[1], rowSpan, c[3], c[4]];
    });
    return new Row(row.attr, cells, row.start, row.end);
  });
}
