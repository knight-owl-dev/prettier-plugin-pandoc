// Headings and thematic breaks: blocks that end on the line they start, which
// prettier prints as Pandoc reads them. They are recognized for the block
// start they leave behind, and nothing is reported.

import { perSyntax } from '../syntax.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

// An ATX heading starts in the first column: indented, it is paragraph text.
const ATX = /^#{1,6}(\s|$)/;

const patterns = perSyntax((syntax) => ({
  setextUnderline: syntax.atBlockIndent('(=+|-+)[ \\t]*$'),
  thematicBreak: syntax.atBlockIndent('([-*_])([ \\t]*\\1){2,}[ \\t]*$'),
}));

const endsHere = (pattern, lines, at) =>
  pattern.test(lines[at].text) ? { last: at, after: 'start' } : null;

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
 *
 * @type {Recognizer}
 */
export const atxHeading = {
  name: 'atx-heading',
  interruptsParagraph: false,
  match: (lines, at) => endsHere(ATX, lines, at),
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
    if (context.paragraph?.lines !== 1) return null;
    return endsHere(patterns(context.syntax).setextUnderline, lines, at);
  },
};

/** @type {Recognizer} */
export const thematicBreak = {
  name: 'thematic-break',
  interruptsParagraph: false,
  match: (lines, at, { syntax }) =>
    endsHere(patterns(syntax).thematicBreak, lines, at),
};
