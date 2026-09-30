// Line blocks: verse, whose line breaks are its meaning.

import { isSetextUnderline } from './heading.js';
import { PIPE_SEPARATOR } from './table.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

// A verse line opens on a bar in the first column and a space or the end of
// the line; a line starting with a space continues the verse line above.
const VERSE = /^\|( |$)/;
const CONTINUATION = /^ +\S/;

/**
 * A line block runs until a line is neither verse nor its continuation, and
 * what follows starts a block of its own. A bar line over a separator row is a
 * pipe table's header instead, and over an underline a heading.
 *
 * @type {Recognizer}
 */
export const lineBlock = {
  name: 'line-block',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    if (!VERSE.test(lines[at].text)) return null;
    const next = lines[at + 1]?.text ?? '';
    if (PIPE_SEPARATOR.test(next)) return null;
    if (isSetextUnderline(next, syntax) && !CONTINUATION.test(next))
      return null;
    let last = at;
    while (
      last + 1 < lines.length &&
      (VERSE.test(lines[last + 1].text) ||
        CONTINUATION.test(lines[last + 1].text))
    ) {
      last++;
    }
    return {
      last,
      spans: [{ type: 'line-block', from: at, to: last }],
    };
  },
};
