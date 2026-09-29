// Code blocks, fenced and indented. Pandoc reads no markdown inside either, so
// each is reported for a caller scanning for inline syntax to pass over.

import { BLANK, indentOf } from '../lines.js';
import { perSyntax } from '../syntax.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */

const patterns = perSyntax((syntax) => ({
  fence: syntax.atBlockIndent('(`{3,}|~{3,})'),
}));

const isIndented = (text, syntax) =>
  !BLANK.test(text) && indentOf(text, syntax.tabStop) >= syntax.codeIndent;

// A fence closes on its own character, in a run at least as long as the one it
// opened with, and nothing after it.
function closes(line, opener, fencePattern) {
  const fence = fencePattern.exec(line);
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
  match(lines, at, { syntax }) {
    const { fence } = patterns(syntax);
    const opener = fence.exec(lines[at].text)?.[1];
    if (opener === undefined) return null;
    let last = lastContent(lines, at);
    for (let n = at + 1; n < lines.length; n++) {
      if (closes(lines[n].text, opener, fence)) {
        last = n;
        break;
      }
    }
    return {
      last,
      after: 'start',
      spans: [{ type: 'fenced-code', from: at, to: last }],
    };
  },
};

/**
 * Indented code — one tab stop deep — runs on through blank lines and ends at
 * its last indented line.
 *
 * @type {Recognizer}
 */
export const indentedCode = {
  name: 'indented-code',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    if (!isIndented(lines[at].text, syntax)) return null;
    let last = at;
    for (let n = at + 1; n < lines.length; n++) {
      const text = lines[n].text;
      if (isIndented(text, syntax)) last = n;
      else if (!BLANK.test(text)) break;
    }
    return {
      last,
      after: 'start',
      spans: [{ type: 'indented-code', from: at, to: last }],
    };
  },
};
