// Code blocks, fenced and indented. Pandoc reads no markdown inside either, so
// each is reported for a caller scanning for inline syntax to pass over.

import { ATTRIBUTES } from '../attributes.js';
import { BLANK, indentOf } from '../lines.js';
import { perSyntax } from '../syntax.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */

// What Pandoc takes after an opening fence: a raw attribute, or a language
// and an attribute block, either optional, then nothing.
const INFO = [
  '[ \\t]*',
  `(?:\\{[ \\t]*=[\\w-]+[ \\t]*\\}`,
  `|[^\\s\`{}]*[ \\t]*(?:${ATTRIBUTES})?)`,
  '[ \\t]*$',
].join('');

const patterns = perSyntax((syntax) => ({
  fence: syntax.atBlockIndent('(`{3,}|~{3,})'),
  opener: syntax.atBlockIndent(`(\`{3,}|~{3,})${INFO}`),
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

/**
 * A backtick fence interrupts a paragraph; a tilde fence opens only at a block
 * start. One never closed, or with info Pandoc refuses, is paragraph text.
 *
 * @type {Recognizer}
 */
export const fencedCode = {
  name: 'fenced-code',
  interruptsParagraph: true,
  opensAhead: (text, syntax) => patterns(syntax).opener.test(text),
  match(lines, at, { syntax, paragraph }) {
    const { fence, opener: opens } = patterns(syntax);
    const opener = opens.exec(lines[at].text)?.[1];
    if (opener === undefined) return null;
    if (paragraph !== null && opener[0] === '~') return null;
    let last = null;
    for (let n = at + 1; n < lines.length && last === null; n++) {
      if (closes(lines[n].text, opener, fence)) last = n;
    }
    if (last === null) return null;
    return {
      last,
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
      spans: [{ type: 'indented-code', from: at, to: last }],
    };
  },
};
