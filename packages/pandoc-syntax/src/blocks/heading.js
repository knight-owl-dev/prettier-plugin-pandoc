// Headings and thematic breaks: blocks that end on the line they start, a
// setext heading on its underline.

import { perSyntax } from '../syntax.js';
import { holdsRaw } from './raw-tex.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

// An ATX heading starts in the first column: indented, it is paragraph text.
const ATX = /^#{1,6}(\s|$)/;

const patterns = perSyntax((syntax) => ({
  setextUnderline: syntax.atBlockIndent('(=+|-+)[ \\t]*$'),
  thematicBreak: syntax.atBlockIndent('([-*_])([ \\t]*\\1){2,}[ \\t]*$'),
}));

const endsHere = (pattern, type, lines, at) =>
  pattern.test(lines[at].text)
    ? { last: at, spans: [{ type, from: at, to: at }] }
    : null;

/**
 * Whether a line underlines the one-line paragraph above it as a heading.
 *
 * @param {string} text
 * @param {import('../syntax.js').Syntax} syntax
 */
export const isSetextUnderline = (text, syntax) =>
  patterns(syntax).setextUnderline.test(text);

/**
 * Whether a line is a thematic break.
 *
 * @param {string} text
 * @param {import('../syntax.js').Syntax} syntax
 */
export const isThematicBreak = (text, syntax) =>
  patterns(syntax).thematicBreak.test(text);

/**
 * Pandoc wants a blank line before a heading, so `#` continues a paragraph.
 * Raw TeX that would end a paragraph in its text makes it one.
 *
 * @type {Recognizer}
 */
export const atxHeading = {
  name: 'atx-heading',
  interruptsParagraph: false,
  match: (lines, at) =>
    holdsRaw(lines, at) ? null : endsHere(ATX, 'heading', lines, at),
};

/**
 * An underline turns a one-line paragraph into a heading; under two lines the
 * paragraph continues, and at a block start there is nothing to underline.
 *
 * @type {Recognizer}
 */
export const setextUnderline = {
  name: 'setext-underline',
  interruptsParagraph: true,
  match(lines, at, context) {
    const { paragraph, syntax } = context;
    if (paragraph?.lines !== 1) return null;
    if (!patterns(syntax).setextUnderline.test(lines[at].text)) return null;
    /** @type {import('../types.js').SpanSpec} */
    const span = {
      type: 'heading',
      from: at - 1,
      to: at,
      start: paragraph.start,
    };
    return { last: at, spans: [span] };
  },
};

/** @type {Recognizer} */
export const thematicBreak = {
  name: 'thematic-break',
  interruptsParagraph: false,
  match: (lines, at, { syntax }) =>
    endsHere(patterns(syntax).thematicBreak, 'thematic-break', lines, at),
};
