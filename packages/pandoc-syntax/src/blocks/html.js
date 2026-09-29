// Raw HTML: comments, which Pandoc reads no markdown inside, and lines of a
// block-level tag, which end the block before them.

import { BLANK } from '../lines.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

const COMMENT = /^ {0,3}<!--/;
const COMMENT_END = '-->';

// The tags that open an HTML block. Inline ones — `<span>`, `<em>` — open a
// paragraph instead.
const BLOCK_TAGS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dialog',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h[1-6]',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
];
const BLOCK_TAG = new RegExp(
  `^ {0,3}</?(${BLOCK_TAGS.join('|')})(\\s|/?>|$)`,
  'i',
);

/**
 * A comment runs to the line its `-->` is on, or to the end of the document.
 * Pandoc continues a paragraph into one, so it opens only at a block start.
 *
 * @type {Recognizer}
 */
export const htmlComment = {
  name: 'html-comment',
  interruptsParagraph: false,
  match(lines, at) {
    if (!COMMENT.test(lines[at].text)) return null;
    let last = at;
    for (let n = at; n < lines.length; n++) {
      if (!BLANK.test(lines[n].text)) last = n;
      if (lines[n].text.includes(COMMENT_END)) {
        last = n;
        break;
      }
    }
    return {
      last,
      after: 'start',
      spans: [{ type: 'html-comment', from: at, to: last }],
    };
  },
};

/**
 * A line of a block-level tag ends any paragraph before it, and the block
 * after it starts afresh. Prettier prints the tag as it stands, so nothing is
 * reported.
 *
 * @type {Recognizer}
 */
export const htmlBlockTag = {
  name: 'html-block-tag',
  interruptsParagraph: true,
  match(lines, at) {
    return BLOCK_TAG.test(lines[at].text) ? { last: at, after: 'start' } : null;
  },
};
