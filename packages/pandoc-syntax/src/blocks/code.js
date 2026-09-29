// Code blocks, fenced and indented. Pandoc reads no markdown inside either, so
// each is reported for a caller scanning for inline syntax to pass over.

import { BLANK, indentOf, TAB_STOP } from '../lines.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Columns of indentation that make a line code: one tab stop, as Pandoc reads
 * it. Reading and writing both hang on it — a printer emitting fewer would turn
 * code into a paragraph, more would put spaces into the code.
 */
export const CODE_INDENT = TAB_STOP;

const isIndented = (text) => !BLANK.test(text) && indentOf(text) >= CODE_INDENT;

// A fence closes on its own character, in a run at least as long as the one it
// opened with, and nothing after it.
function closes(line, opener) {
  const fence = FENCE.exec(line);
  return (
    fence !== null &&
    fence[1][0] === opener[0] &&
    fence[1].length >= opener.length &&
    BLANK.test(line.slice(fence[0].length))
  );
}

// The last non-blank line of `lines` from `at` on.
function lastContent(lines, at) {
  let last = at;
  for (let n = at; n < lines.length; n++) {
    if (!BLANK.test(lines[n].text)) last = n;
  }
  return last;
}

/**
 * A fence interrupts a paragraph. One never closed runs to the end of the
 * document.
 *
 * @type {Recognizer}
 */
export const fencedCode = {
  name: 'fenced-code',
  interruptsParagraph: true,
  match(lines, at) {
    const opener = FENCE.exec(lines[at].text)?.[1];
    if (opener === undefined) return null;
    let last = lastContent(lines, at);
    for (let n = at + 1; n < lines.length; n++) {
      if (closes(lines[n].text, opener)) {
        last = n;
        break;
      }
    }
    return {
      last,
      after: 'start',
      spans: [{ type: 'code-block', from: at, to: last }],
    };
  },
};

/**
 * Indented code runs on through blank lines and ends at its last indented one.
 *
 * @type {Recognizer}
 */
export const indentedCode = {
  name: 'indented-code',
  interruptsParagraph: false,
  match(lines, at) {
    if (!isIndented(lines[at].text)) return null;
    let last = at;
    for (let n = at + 1; n < lines.length; n++) {
      const text = lines[n].text;
      if (isIndented(text)) last = n;
      else if (!BLANK.test(text)) break;
    }
    return {
      last,
      after: 'start',
      spans: [{ type: 'code-block', from: at, to: last }],
    };
  },
};
