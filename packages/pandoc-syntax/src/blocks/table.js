// Tables. Pandoc's own forms — grid, simple, multiline — are reported; a pipe
// table is CommonMark's too, and prettier prints one as Pandoc reads it, so it
// is only passed over.

import { BLANK } from '../lines.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */

// A grid table is framed in `+` rules and its rows by `|`.
const GRID_RULE = /^[ \t]*\+[-=:]+(\+[-=:]+)*\+[ \t]*$/;
const GRID_ROW = /^[ \t]*[+|]/;

// A dash line is one or more runs of dashes. Several runs split a simple
// table's columns; a multiline or headerless table opens and closes on one.
const DASH_COLUMNS = /^[ \t]*-+([ \t]+-+)+[ \t]*$/;
const DASH_LINE = /^[ \t]*-+([ \t]+-+)*[ \t]*$/;

const PIPE_ROW = /^[ \t]*\|/;
export const PIPE_SEPARATOR =
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

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
// ends on its last framed line; a simple table at the next blank line, so a
// text line straight after it is another row.
function pandocTableAt(lines, at) {
  const line = lines[at].text;
  const next = lines[at + 1]?.text;
  if (GRID_RULE.test(line)) {
    return {
      type: 'grid-table',
      last: lastWhile(lines, at, (l) => GRID_ROW.test(l)),
    };
  }
  if (next === undefined) return null;
  if (!BLANK.test(line) && DASH_COLUMNS.test(next)) {
    return {
      type: 'simple-table',
      last: lastWhile(lines, at, (l) => !BLANK.test(l)),
    };
  }
  if (DASH_LINE.test(line) && !BLANK.test(next)) return dashTable(lines, at);
  return null;
}

/** @type {Recognizer} */
export const pandocTable = {
  name: 'pandoc-table',
  interruptsParagraph: false,
  match(lines, at) {
    const table = pandocTableAt(lines, at);
    if (table === null) return null;
    return {
      last: table.last,
      after: 'start',
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
  match(lines, at) {
    const next = lines[at + 1]?.text;
    if (!PIPE_ROW.test(lines[at].text) || next === undefined) return null;
    if (!PIPE_SEPARATOR.test(next)) return null;
    return {
      last: lastWhile(lines, at, (l) => PIPE_ROW.test(l)),
      after: 'start',
    };
  },
};
