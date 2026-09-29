// Headings and thematic breaks: blocks that end on the line they start, which
// prettier prints as Pandoc reads them. They are recognized for the block
// start they leave behind, and nothing is reported.

/** @typedef {import('../types.js').Recognizer} Recognizer */

const ATX = /^ {0,3}#{1,6}(\s|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
export const THEMATIC_BREAK = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;

const endsHere = (pattern) => (lines, at) =>
  pattern.test(lines[at].text) ? { last: at, after: 'start' } : null;

/**
 * Pandoc wants a blank line before a heading, so `#` continues a paragraph.
 *
 * @type {Recognizer}
 */
export const atxHeading = {
  name: 'atx-heading',
  interruptsParagraph: false,
  match: endsHere(ATX),
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
    return endsHere(SETEXT_UNDERLINE)(lines, at);
  },
};

/** @type {Recognizer} */
export const thematicBreak = {
  name: 'thematic-break',
  interruptsParagraph: false,
  match: endsHere(THEMATIC_BREAK),
};
