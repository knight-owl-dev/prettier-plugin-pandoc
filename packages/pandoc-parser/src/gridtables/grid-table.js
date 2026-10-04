// reStructuredText-style grid tables: lines of `+`, `-`, `=` and `|`
// traced into cells on a character grid, each cell's lines kept with the
// source offset of each character.
//
// Ported from gridtables 0.1.1.0's `Text.GridTable` (`Parse`, `Trace`,
// `ArrayTable`, `rows`). Rows and columns count from 1, as gridtables'.

import { charWidth, realLength } from '../text-width.js';

/**
 * A line of the table: its text, ends stripped, and where it starts.
 *
 * @typedef {{text: string, at: number}} Line
 */

/**
 * A cell's line: its text, and the source offset of each code unit, -1 for
 * one that stands for nothing written.
 *
 * @typedef {{text: string, offsets: number[]}} CellLine
 */

/**
 * A cell with content, spanning `rowSpan` rows and `colSpan` columns, or
 * one a spanning cell covers.
 *
 * @see Text.GridTable.ArrayTable.GridCell
 * @typedef {{content: CellLine[], rowSpan: number, colSpan: number} | {continues: [number, number]}} GridCell
 */

/**
 * A table: its cells by row and column, the rows its head and foot end at,
 * and each column's alignment and width.
 *
 * @see Text.GridTable.ArrayTable.ArrayTable
 * @typedef {object} ArrayTable
 * @property {GridCell[][]} cells
 * @property {number | null} head
 * @property {number | null} foot
 * @property {[string, number][]} colSpecs
 * @property {number[]} rowSeps The character rows of the rows' borders.
 */

const skipSpaces = (text, at) => {
  while (text[at] === ' ' || text[at] === '\t') at++;
  return at;
};

// `:`? dashes `:`? `+`: where it ends, or -1.
function gridPart(text, at) {
  if (text[at] === ':') at++;
  const dashes = at;
  while (text[at] === '-') at++;
  if (at === dashes) return -1;
  if (text[at] === ':') at++;
  return text[at] === '+' ? at + 1 : -1;
}

/**
 * The table at `from`: a first line of `+` and dashed parts, then lines
 * opening with `+` or `|`. The table, its lines, and where they end; or
 * null.
 *
 * @see Text.GridTable.Parse.gridTable
 * @param {string} text
 * @param {number} from
 * @returns {{table: ArrayTable, lines: Line[], end: number} | null}
 */
export function gridTable(text, from) {
  if (text[from] !== '+') return null;
  let at = from + 1;
  for (let parts = 0; ; parts++) {
    const next = gridPart(text, at);
    if (next === -1) {
      if (parts === 0) return null;
      break;
    }
    at = next;
  }
  const firstEnd = at;
  at = skipSpaces(text, at);
  if (text[at] !== '\n') return null;
  const lines = [{ text: text.slice(from, firstEnd), at: from }];
  at++;
  for (;;) {
    const line = tableLine(text, at);
    if (line === null) break;
    lines.push(line.line);
    at = line.end;
  }
  if (lines.length === 1) return null;
  const table = traceLines(lines);
  return table === null ? null : { table, lines, end: at };
}

/**
 * A line opening with `+` or `|`, its end stripped, and where it ends.
 *
 * @see Text.GridTable.Parse.tableLine
 * @param {string} text
 * @param {number} at
 */
function tableLine(text, at) {
  if (text[at] !== '+' && text[at] !== '|') return null;
  let end = at;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
  if (text[end] !== '\n') return null;
  const line = text.slice(at, end).replace(/\s+$/u, '');
  return { line: { text: line, at }, end: end + 1 };
}

// A grid character: one written (`c`, at `at`), one after zero-width ones
// (`zw` before it), a wide one's padding, or a short line's.
const WP = Object.freeze({ k: 'WP' });
const MISSING = Object.freeze({ k: 'Missing' });

/**
 * The lines as a grid, a column per half-width character, as wide as the
 * widest line, short lines padded. Laid out row after row from one list,
 * as Haskell's `listArray` lays it: a line ending in zero-width characters
 * gets no padding, which shifts every row after it.
 *
 * @see Text.GridTable.Trace.toCharGrid
 * @param {Line[]} lines
 */
function toCharGrid(lines) {
  const width = Math.max(0, ...lines.map((l) => realLength(l.text)));
  const flat = [];
  for (const line of lines) flat.push(...gridChars(line, width));
  return { flat, height: lines.length, width };
}

// A line's grid characters, `width` of them unless it ends in zero-width
// ones.
function gridChars({ text, at }, width) {
  const row = [];
  let i = 0;
  const next = () => {
    const c = String.fromCodePoint(text.codePointAt(i));
    const offset = at + i;
    i += c.length;
    return { c, at: offset };
  };
  const width0 = () =>
    i < text.length &&
    charWidth(String.fromCodePoint(text.codePointAt(i))) === 0;
  while (i < text.length && row.length < width) {
    const { c, at: offset } = next();
    const w = charWidth(c);
    if (w === 2) row.push({ k: 'C', c, at: offset }, WP);
    else if (w === 1) row.push({ k: 'C', c, at: offset });
    else {
      const zw = [{ c, at: offset }];
      while (width0()) zw.push(next());
      if (i >= text.length) {
        row.push({ k: 'CZ', zw, c: '\0', at: -1 });
        return row.slice(0, width);
      }
      const after = next();
      row.push({ k: 'CZ', zw, c: after.c, at: after.at });
      if (charWidth(after.c) === 2) row.push(WP);
    }
  }
  row.length = Math.min(row.length, width);
  while (row.length < width) row.push(MISSING);
  return row;
}

// The character at row `i`, column `j`, from 1; undefined outside.
const at = (grid, i, j) =>
  j >= 1 && j <= grid.width
    ? grid.flat[(i - 1) * grid.width + (j - 1)]
    : undefined;
const charAt = (grid, i, j) => {
  const g = at(grid, i, j);
  return g?.k === 'C' ? g.c : undefined;
};
const inRange = (grid, i, j) =>
  i >= 1 && i <= grid.height && j >= 1 && j <= grid.width;

/**
 * The columns a separator line of `c` marks at row `i`, each with the
 * alignment its colons give, or null where the row is none.
 *
 * @see Text.GridTable.Trace.colSpecsInLine
 * @param {string} c
 */
function colSpecsInLine(c, grid, i) {
  if (charAt(grid, i, 1) !== '+') return null;
  const specs = [];
  const findEnd = (j) => {
    for (;;) {
      const x = charAt(grid, i, j);
      if (x === '+') return [j, false];
      if (x === ':')
        return charAt(grid, i, j + 1) === '+' ? [j + 1, true] : null;
      if (x !== c) return null;
      j++;
    }
  };
  for (let j = 2; j < grid.width; ) {
    const end = findEnd(j + 1);
    if (end === null) return null;
    const left = charAt(grid, i, j) === ':';
    const [colEnd, right] = end;
    const align = left
      ? right
        ? 'AlignCenter'
        : 'AlignLeft'
      : right
        ? 'AlignRight'
        : 'AlignDefault';
    specs.push({ colStart: j, colEnd, align });
    j = colEnd + 1;
  }
  return specs;
}

/**
 * The rows of separator lines of `=`, which part head, body and foot.
 *
 * @see Text.GridTable.Trace.findSeparators
 */
function findSeparators(grid) {
  const seps = [];
  for (let i = 1; i <= grid.height; i++) {
    const specs = colSpecsInLine('=', grid, i);
    if (specs !== null) seps.push({ line: i, specs });
  }
  return seps;
}

/**
 * The grid with the given rows' `=` and `:` made `-`.
 *
 * @see Text.GridTable.Trace.convertToNormalLines
 */
function convertToNormalLines(sepLines, grid) {
  const flat = grid.flat.slice();
  for (const i of sepLines) {
    for (let j = 1; j <= grid.width; j++) {
      const k = (i - 1) * grid.width + (j - 1);
      const g = flat[k];
      if (g?.k === 'C' && (g.c === '=' || g.c === ':'))
        flat[k] = { ...g, c: '-' };
    }
  }
  return { ...grid, flat };
}

/**
 * A cell traced from its top-left corner: its bottom-right corner, and the
 * row and column borders seen. Right along its top to a `+` it can trace
 * down, left and up from, else further right, else the last cell of a
 * short row.
 *
 * @see Text.GridTable.Trace.scanRight
 */
const scanRight = (grid, top, left) =>
  scanRightFrom(grid, top, left, left + 1, new Set());

// `scanRight` from column `from`, the borders seen before it in `colseps`.
function scanRightFrom(grid, top, left, from, colseps) {
  for (let j = from; ; j++) {
    if (!inRange(grid, top, j)) return null;
    const c = charAt(grid, top, j);
    if (c === '-') continue;
    if (c !== '+') return null;
    const seen = new Set(colseps).add(j);
    const down = scanDown(grid, top, left, j);
    if (down !== null) {
      for (const s of down.colseps) seen.add(s);
      return { ...down, colseps: seen };
    }
    return (
      scanRightFrom(grid, top, left, j + 1, seen) ??
      lastCellInRow(grid, top, left, j + 1)
    );
  }
}

/** @see Text.GridTable.Trace.scanDown */
function scanDown(grid, top, left, right) {
  const rowseps = new Set();
  for (let i = top + 1; ; i++) {
    if (!inRange(grid, i, right)) return null;
    const c = charAt(grid, i, right);
    if (c === '+') {
      rowseps.add(i);
      const back = scanLeft(grid, top, left, i, right);
      if (back === null) continue;
      for (const s of back.rowseps) rowseps.add(s);
      return { bottom: i, right, rowseps, colseps: back.colseps };
    }
    if (c === '|') continue;
    // All but the last column end with a border.
    if (right !== grid.width) return null;
  }
}

/** @see Text.GridTable.Trace.scanLeft */
function scanLeft(grid, top, left, bottom, right) {
  if (charAt(grid, bottom, left) !== '+') return null;
  const colseps = new Set();
  for (let j = left + 1; j <= right - 1; j++) {
    const c = charAt(grid, bottom, j);
    if (c === '+') colseps.add(j);
    else if (c !== '-') return null;
  }
  const rowseps = scanUp(grid, top, left, bottom);
  return rowseps === null ? null : { rowseps, colseps };
}

/** @see Text.GridTable.Trace.scanUp */
function scanUp(grid, top, left, bottom) {
  const rowseps = new Set();
  for (let i = top + 1; i <= bottom - 1; i++) {
    const c = charAt(grid, i, left);
    if (c === '+') rowseps.add(i);
    else if (c !== '|') return null;
  }
  return rowseps;
}

/**
 * The last cell of a row whose line is short: to the first row below that
 * ends it, its right border the grid's last column.
 *
 * @see Text.GridTable.Trace.lastCellInRow
 * @see Text.GridTable.Trace.scanRestOfLines
 */
function lastCellInRow(grid, top, left, right) {
  if (!inRange(grid, top, right) || at(grid, top, right) !== MISSING) {
    return null;
  }
  for (let i = top + 1; i <= grid.height; i++) {
    if (scanRightRestOfLine(grid, left, i)) {
      return {
        bottom: i,
        right: grid.width,
        rowseps: new Set([i]),
        colseps: new Set([grid.width]),
      };
    }
  }
  return null;
}

/** @see Text.GridTable.Trace.scanRightRestOfLine */
function scanRightRestOfLine(grid, left, bottom) {
  if (charAt(grid, bottom, left) !== '+') return false;
  for (let j = left + 1; j <= grid.width; j++) {
    const g = at(grid, bottom, j);
    if (g === MISSING) continue;
    if (g?.k !== 'C' || (g.c !== '+' && g.c !== '-')) return false;
  }
  return true;
}

/**
 * A cell's lines, its borders left out: each character with its offset.
 *
 * @see Text.GridTable.Trace.getLines
 * @returns {CellLine[]}
 */
function getLines(grid, top, left, bottom, right) {
  const lines = [];
  for (let i = top + 1; i <= bottom - 1; i++) {
    let text = '';
    const offsets = [];
    const add = (c, offset) => {
      for (let k = 0; k < c.length; k++)
        offsets.push(offset < 0 ? -1 : offset + k);
      text += c;
    };
    for (let j = left + 1; j <= right - 1; j++) {
      const g = at(grid, i, j);
      if (g?.k === 'C') add(g.c, g.at);
      else if (g?.k === 'CZ') {
        for (const z of g.zw) add(z.c, z.at);
        add(g.c, g.at);
      }
    }
    lines.push({ text, offsets });
  }
  return lines;
}

/**
 * The cells traced from the grid's corners, each corner a cell's top left
 * where one starts there, a traced cell's other corners queued.
 *
 * @see Text.GridTable.Trace.traceCharGrid
 */
function traceCharGrid(grid) {
  const rowSeps = new Set([1]);
  const colSeps = new Set([1]);
  const cells = new Map();
  const corners = [[1, 1]];
  const seen = new Set();
  const key = (i, j) => `${i},${j}`;
  // The smallest corner, by row, then column.
  const take = () => {
    let best = 0;
    for (let k = 1; k < corners.length; k++) {
      const [a, b] = [corners[k], corners[best]];
      if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) best = k;
    }
    return corners.splice(best, 1)[0];
  };
  const queue = (i, j) => {
    if (seen.has(key(i, j))) return;
    seen.add(key(i, j));
    corners.push([i, j]);
  };
  seen.add(key(1, 1));
  while (corners.length > 0) {
    const [top, left] = take();
    seen.delete(key(top, left));
    const traced = scanRight(grid, top, left);
    if (traced === null) continue;
    const { bottom, right } = traced;
    for (const s of traced.rowseps) rowSeps.add(s);
    for (const s of traced.colseps) colSeps.add(s);
    queue(top, right);
    queue(bottom, left);
    cells.set(key(top, left), {
      content: getLines(grid, top, left, bottom, right),
      left,
      right,
      top,
      bottom,
    });
  }
  return { rowSeps, colSeps, cells: [...cells.values()] };
}

/**
 * The table the lines trace, or null where they trace no cell.
 *
 * @see Text.GridTable.Trace.traceLines
 * @param {Line[]} lines
 * @returns {ArrayTable | null}
 */
export function traceLines(lines) {
  const grid = toCharGrid(lines);
  const specs1 = colSpecsInLine('-', grid, 1);
  const partSeps = findSeparators(grid);
  const normal = convertToNormalLines(
    [1, ...partSeps.map((p) => p.line)],
    grid,
  );
  const traced = traceCharGrid(normal);
  if (traced.cells.length === 0) return null;
  return tableFromTraceInfo(traced, partSeps, specs1);
}

const ascending = (set) => [...set].sort((a, b) => a - b);

/**
 * The table from the traced cells and borders: rows and columns between
 * the borders, the first part separator's alignments or else the first
 * line's, the head ending at the first part separator, the foot starting
 * at the one before a last separator that is the table's last line.
 *
 * @see Text.GridTable.Trace.tableFromTraceInfo
 */
function tableFromTraceInfo(traced, partSeps, specs1) {
  const rowseps = ascending(traced.rowSeps);
  const colseps = ascending(traced.colSeps);
  const rowIndex = new Map(rowseps.map((r, k) => [r, k + 1]));
  const colIndex = new Map(colseps.map((c, k) => [c, k + 1]));
  const widths = colseps.slice(1).map((b, k) => b - colseps[k] - 1);
  const aligns = (partSeps[0]?.specs ?? specs1 ?? []).map((s) => s.align);
  const colSpecs = widths.map((w, k) => [aligns[k] ?? 'AlignDefault', w]);
  const lastLine = rowseps.at(-1);
  const headSep =
    partSeps.length > 0 ? rowIndex.get(partSeps[0].line) : undefined;
  const head = headSep === undefined ? null : headSep - 1;
  const [last, beforeLast] = [partSeps.at(-1), partSeps.at(-2)];
  const foot =
    beforeLast !== undefined && last.line === lastLine
      ? (rowIndex.get(beforeLast.line) ?? null)
      : null;
  const rowCount = rowIndex.size - 1;
  const colCount = colIndex.size - 1;
  const cells = Array.from({ length: rowCount }, () =>
    Array(colCount).fill(null),
  );
  const ordered = [...traced.cells].sort(
    (a, b) => a.top - b.top || a.left - b.left,
  );
  for (const { content, left, right, top, bottom } of ordered) {
    const [r, c] = [rowIndex.get(top), colIndex.get(left)];
    const rowSpan = rowIndex.get(bottom) - r;
    const colSpan = colIndex.get(right) - c;
    cells[r - 1][c - 1] = { content, rowSpan, colSpan };
    for (let i = r; i < r + rowSpan; i++) {
      for (let j = c; j < c + colSpan; j++) {
        if ((i !== r || j !== c) && i <= rowCount && j <= colCount) {
          cells[i - 1][j - 1] = { continues: [r, c] };
        }
      }
    }
  }
  for (const row of cells) {
    for (let j = 0; j < row.length; j++) {
      row[j] ??= { content: [], rowSpan: 1, colSpan: 1 };
    }
  }
  return { cells, head, foot, colSpecs, rowSeps: rowseps };
}

/**
 * The table's rows: each its cells with content, in order.
 *
 * @see Text.GridTable.rows
 * @param {ArrayTable} table
 */
export const rows = (table) =>
  table.cells.map((row) => row.filter((cell) => 'content' in cell));
