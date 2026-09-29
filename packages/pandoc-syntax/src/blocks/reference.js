// Link reference definitions: one line each, which prettier prints as Pandoc
// reads it. Recognized for the block start it leaves behind.

import { perSyntax } from '../syntax.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

// A `[^label]:` line is a footnote definition instead.
const patterns = perSyntax((syntax) => ({
  definition: syntax.atBlockIndent('\\[[^\\]^][^\\]]*\\]:[ \\t]*\\S'),
}));

/** @type {Recognizer} */
export const linkReference = {
  name: 'link-reference',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    return patterns(syntax).definition.test(lines[at].text)
      ? { last: at, after: 'start' }
      : null;
  },
};
