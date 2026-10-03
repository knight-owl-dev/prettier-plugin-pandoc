// Tables. Pandoc's own forms — grid, simple, multiline — are reported; a pipe
// table is CommonMark's too, and prettier prints one as Pandoc reads it, so it
// is only passed over.

import { ATTRIBUTES } from '../attributes.js';
import { BLANK, indentOf } from '../lines.js';
import { perSyntax } from '../syntax.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */

// A grid table is framed in `+` rules and its rows by `|`. A dash line is one
// or more runs of dashes: several runs split a simple table's columns, and a
// multiline or headerless table opens and closes on one. Rows sit wherever
// their alignment puts them.
const GRID_ROW = /^[ \t]*[+|]/;
const DASH_COLUMNS = /^[ \t]*-+([ \t]+-+)+[ \t]*$/;
const DASH_LINE = /^[ \t]*-+([ \t]+-+)*[ \t]*$/;
// A pipe table's row: any line with a pipe not escaped, outer ones optional.
const PIPE_ROW = /(^|[^\\])\|/;

// The line a table opens on sits short of indented code: a grid table's first
// rule, the dash line a multiline or headerless table opens on, a simple
// table's column line — whose header above it sits anywhere — and a pipe
// table's first row (`opensPipeRow`).
const opening = perSyntax((syntax) => ({
  gridRule: syntax.atBlockIndent('\\+[-=:]+(\\+[-=:]+)*\\+[ \\t]*$'),
  dashColumns: syntax.atBlockIndent('-+([ \\t]+-+)+[ \\t]*$'),
  dashLine: syntax.atBlockIndent('-+([ \\t]+-+)*[ \\t]*$'),
}));

const opensPipeRow = (text, syntax) =>
  PIPE_ROW.test(text) && indentOf(text, syntax.tabStop) < syntax.codeIndent;
// A pipe table's separator, which holds a pipe whatever its header does:
// dashes alone under a line are a setext underline.
export const PIPE_SEPARATOR =
  /^(?=[^|]*\|)[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

// The last line from `at` on for which `continues` holds of each line after it.
function lastWhile(lines, at, continues) {
  let n = at;
  while (n + 1 < lines.length && continues(lines[n + 1].text)) n++;
  return n;
}

// A headerless table has rows between two column lines. A multiline one has a
// full-width rule, header lines, a column line, rows, and a full-width rule
// again, which closes it only once the column line has been seen. Without its
// closing line the opening dashes are a thematic break.
function dashTable(lines, at) {
  const headerless = DASH_COLUMNS.test(lines[at].text);
  let separated = false;
  for (let n = at + 1; n < lines.length; n++) {
    const row = lines[n].text;
    if (headerless && DASH_COLUMNS.test(row)) {
      return { type: 'simple-table', last: n };
    }
    if (!headerless && DASH_COLUMNS.test(row)) separated = true;
    else if (!headerless && separated && DASH_LINE.test(row)) {
      return { type: 'multiline-table', last: n };
    }
  }
  return null;
}

// Which of Pandoc's tables opens on line `at`, and its last line. A grid table
// needs a rule after its first and ends on its last framed line; a simple
// table needs a row and ends at the next blank line, so a text line straight
// after it is another row.
function pandocTableAt(lines, at, syntax) {
  const { gridRule, dashColumns, dashLine } = opening(syntax);
  const line = lines[at].text;
  const next = lines[at + 1]?.text;
  if (gridRule.test(line)) {
    const last = lastWhile(lines, at, (l) => GRID_ROW.test(l));
    const closed = lines
      .slice(at + 1, last + 1)
      .some((l) => gridRule.test(l.text));
    return closed ? { type: 'grid-table', last } : null;
  }
  if (next === undefined) return null;
  if (!BLANK.test(line) && dashColumns.test(next)) {
    if (BLANK.test(lines[at + 2]?.text ?? '')) return null;
    return {
      type: 'simple-table',
      last: lastWhile(lines, at, (l) => !BLANK.test(l)),
    };
  }
  if (dashLine.test(line) && !BLANK.test(next)) return dashTable(lines, at);
  return null;
}

// A caption Pandoc reads before a table: `:` or `Table:`, its text running to
// a blank line, or through a line ending in attributes between its inlines.
const caption = perSyntax((syntax) =>
  syntax.atBlockIndent('(:(?!\\p{P})|[Tt]able:)', 'u'),
);
const CAPTION_END = new RegExp(`(^|[:\\s])${ATTRIBUTES}[ \\t]*$`);
// What may open an inline construct spanning lines, or a block-level tag.
const NOT_PLAIN = /[<`$\\]/;

/**
 * Whether Pandoc surely reads a table from line `at`, a caption before it or
 * not. A caption counts only where plain: one with a construct that may span
 * lines or end it, or with a line that may end paragraph text, is taken for
 * none, as is one no table follows.
 *
 * @param {Line[]} lines
 * @param {number} at
 * @param {import('../syntax.js').Syntax} syntax
 * @param {(n: number) => boolean} ends Whether paragraph text may end before
 *   line `n`.
 */
export function tableAt(lines, at, syntax, ends) {
  let n = at;
  if (caption(syntax).test(lines[n].text)) {
    for (;;) {
      if (NOT_PLAIN.test(lines[n].text)) return false;
      if (CAPTION_END.test(lines[n].text)) break;
      if (BLANK.test(lines[n + 1]?.text ?? '')) break;
      if (ends(++n)) return false;
    }
    n++;
    while (n < lines.length && BLANK.test(lines[n].text)) n++;
    if (n === lines.length) return false;
  }
  return (
    pandocTableAt(lines, n, syntax) !== null ||
    pipeTable.match(lines, n, { syntax }) !== null
  );
}

/** @type {Recognizer} */
export const pandocTable = {
  name: 'pandoc-table',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    const table = pandocTableAt(lines, at, syntax);
    if (table === null) return null;
    return {
      last: table.last,
      spans: [{ type: table.type, from: at, to: table.last }],
    };
  },
};

/**
 * A row over a separator line opens a pipe table, which runs while rows
 * follow.
 *
 * @type {Recognizer}
 */
export const pipeTable = {
  name: 'pipe-table',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    const next = lines[at + 1]?.text;
    if (!opensPipeRow(lines[at].text, syntax) || next === undefined) {
      return null;
    }
    if (!PIPE_SEPARATOR.test(next)) return null;
    const last = lastWhile(lines, at, (l) => PIPE_ROW.test(l));
    return {
      last,
      spans: [{ type: 'pipe-table', from: at, to: last }],
    };
  },
};
