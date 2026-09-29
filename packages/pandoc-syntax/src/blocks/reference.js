// Link reference definitions: one line each, which prettier prints as Pandoc
// reads it. Recognized for the block start it leaves behind.

/** @typedef {import('../types.js').Recognizer} Recognizer */

// A `[^label]:` line is a footnote definition, whose body is a paragraph.
const DEFINITION = /^ {0,3}\[[^\]^][^\]]*\]:[ \t]*\S/;

/** @type {Recognizer} */
export const linkReference = {
  name: 'link-reference',
  interruptsParagraph: false,
  match(lines, at) {
    return DEFINITION.test(lines[at].text)
      ? { last: at, after: 'start' }
      : null;
  },
};
