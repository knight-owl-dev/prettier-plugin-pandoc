// YAML metadata, which Pandoc reads no markdown inside. Reported for a caller
// scanning for inline syntax to pass over.

import { BLANK } from '../lines.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

const OPEN = /^---[ \t]*$/;
const CLOSE = /^(---|\.\.\.)[ \t]*$/;

/**
 * A `---` line opens metadata when content follows it straight away and a
 * `---` or `...` line closes it later; otherwise it is a thematic break.
 *
 * @type {Recognizer}
 */
export const yamlMetadata = {
  name: 'yaml-metadata',
  interruptsParagraph: false,
  match(lines, at) {
    const next = lines[at + 1]?.text;
    if (!OPEN.test(lines[at].text) || next === undefined || BLANK.test(next)) {
      return null;
    }
    for (let n = at + 1; n < lines.length; n++) {
      if (CLOSE.test(lines[n].text)) {
        return {
          last: n,
          spans: [{ type: 'yaml-metadata', from: at, to: n }],
        };
      }
    }
    return null;
  },
};
