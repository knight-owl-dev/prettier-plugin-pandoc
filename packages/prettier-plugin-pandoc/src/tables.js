// Pipe tables aligned, as prettier aligns them: each column padded to its
// widest cell, the separator's dashes and colons to match. Simple,
// multiline and grid tables keep their layout, which is their meaning.
//
// @see prettier's src/language-markdown/printer-markdown.js (printTable)

import { util } from 'prettier';
import { lineStart } from './blocks.js';
import { edited, markerEdits } from './emphasis.js';

/** @typedef {import('./wrap.js').View} View */

const SEPARATOR = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

// Pandoc's --columns: a pipe table with a line past it takes its column
// widths from its dashes.
const COLUMNS = 72;

/**
 * A pipe table's rows aligned, and the span of the source they replace.
 * Null for any other table, and for one whose widths come from its dashes.
 *
 * @param {{c: unknown[]}} block
 * @param {View} view
 * @returns {{from: number, to: number, text: string} | null}
 */
export function alignedPipeTable(block, view) {
  const { text } = view;
  const [, , colspecs, head, bodies] = block.c;
  const headRows = head[1];
  const bodyRows = bodies.flatMap((body) => [...body[2], ...body[3]]);
  const rows = [...headRows, ...bodyRows];
  if (rows.length === 0 || headRows.length > 1) return null;
  // The separator: after the header, or first where there is none.
  const firstStart = lineStart(text, view.start(rows[0].start));
  const from =
    headRows.length === 0 ? lineStart(text, firstStart - 1) : firstStart;
  const to = view.end(rows.at(-1).end);
  const lines = text.slice(from, to).split('\n');
  const separatorAt = headRows.length === 0 ? 0 : 1;
  if (lines.length !== rows.length + 1 || !SEPARATOR.test(lines[separatorAt])) {
    return null;
  }
  if (lines.some((line) => util.getStringWidth(line) > COLUMNS)) return null;
  const written = rows.map((row) =>
    row.cells.map((cell) => cellText(cell, view, false)),
  );
  if (written.flat().some((cell) => cell === null || cell.includes('\n'))) {
    return null;
  }
  // Text Pandoc drops, a cell past the separator's columns, stays: written.
  const bare = (line) => line.replace(/[\s|]/g, '');
  const rowLines = lines.filter((_, k) => k !== separatorAt);
  if (rowLines.some((line, k) => bare(line) !== bare(written[k].join('')))) {
    return null;
  }
  const cells = rows.map((row) =>
    row.cells.map((cell) => cellText(cell, view, true)),
  );
  const aligns = colspecs.map(([align]) => align.t);
  const widths = aligns.map((_, k) =>
    Math.max(3, ...cells.map((row) => util.getStringWidth(row[k] ?? ''))),
  );
  const printRow = (row) =>
    `| ${widths.map((w, k) => pad(row[k] ?? '', w, aligns[k])).join(' | ')} |`;
  const separator = `| ${widths.map((w, k) => dashes(w, aligns[k])).join(' | ')} |`;
  const printed = cells.map(printRow);
  printed.splice(separatorAt, 0, separator);
  if (printed.some((line) => util.getStringWidth(line) > COLUMNS)) return null;
  return { from, to, text: printed.join('\n') };
}

/**
 * Each cell's emphasis in prettier's markers, for a table that keeps its
 * layout: a marker swap keeps each line's length.
 *
 * @param {{c: unknown[]}} block
 * @param {View} view
 */
export function cellEdits(block, view) {
  const [, , , head, bodies, foot] = block.c;
  const rows = [
    ...head[1],
    ...bodies.flatMap((body) => [...body[2], ...body[3]]),
    ...foot[1],
  ];
  return markerEdits(
    rows.flatMap((row) => row.cells.map((cell) => cell[4])),
    view,
  );
}

// A cell's text: what its contents span, emphasis markers prettier's
// where `edit`; empty for none.
function cellText(cell, view, edit) {
  const blocks = cell[4];
  if (blocks.length === 0) return '';
  const start = view.start(blocks[0].start);
  const end = view.end(blocks.at(-1).end);
  if (start > end) return null;
  const edits = edit ? markerEdits(blocks, view) : [];
  edits.sort((a, b) => a.from - b.from);
  return edited(view.text, start, end, edits).trim();
}

// `text` padded to `width` by its column's alignment.
function pad(text, width, align) {
  const space = width - util.getStringWidth(text);
  if (align === 'AlignRight') return ' '.repeat(space) + text;
  if (align === 'AlignCenter') {
    const before = Math.floor(space / 2);
    return ' '.repeat(before) + text + ' '.repeat(space - before);
  }
  return text + ' '.repeat(space);
}

// A separator cell keeping its column's alignment as Pandoc read it.
function dashes(width, align) {
  const left = align === 'AlignLeft' || align === 'AlignCenter' ? ':' : '-';
  const right = align === 'AlignRight' || align === 'AlignCenter' ? ':' : '-';
  return `${left}${'-'.repeat(width - 2)}${right}`;
}
