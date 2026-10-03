// Raw HTML: comments, which Pandoc reads no markdown inside, and lines of a
// block-level tag, which end the block before them.

import { BLANK } from '../lines.js';
import { perSyntax } from '../syntax.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

const COMMENT_END = '-->';

// The tags that open an HTML block, as Pandoc lists them; test/interrupts.test.js
// asks Pandoc about every HTML element. Inline ones — `<span>`, `<em>` — open
// a paragraph instead.
const BLOCK_TAGS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'canvas',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frameset',
  'h[1-6]',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'li',
  'main',
  'menu',
  'meta',
  'nav',
  'noframes',
  'ol',
  'output',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
];
// Block tags only as they open, never as they close.
const OPENING_BLOCK_TAGS = ['script'];

const TAG = `(</?(${BLOCK_TAGS.join('|')})|<(${OPENING_BLOCK_TAGS.join('|')}))(\\s|/?>|$)`;
const BLOCK_TAG = new RegExp(TAG, 'iy');

/**
 * Whether a block-level tag opens at `at`: one Pandoc reads as no inline tag.
 *
 * @param {string} text
 * @param {number} at
 */
export function opensBlockTag(text, at) {
  BLOCK_TAG.lastIndex = at;
  return BLOCK_TAG.test(text);
}

// A tag at any depth, for where indented code cannot open.
const TAG_AT_ANY_INDENT = new RegExp(`^[ \\t]*${TAG}`, 'i');
const patterns = perSyntax((syntax) => ({
  comment: syntax.atBlockIndent('<!--'),
  blockTag: syntax.atBlockIndent(TAG, 'i'),
}));

/**
 * A comment runs to the line its `-->` is on, or to the end of the document.
 * Pandoc continues a paragraph into one, so it opens only at a block start.
 *
 * @type {Recognizer}
 */
export const htmlComment = {
  name: 'html-comment',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    if (!patterns(syntax).comment.test(lines[at].text)) return null;
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
      spans: [{ type: 'html-comment', from: at, to: last }],
    };
  },
};

/**
 * A line of a block-level tag ends any paragraph before it, and the block
 * after it starts afresh. Prettier prints the tag as it stands, so nothing is
 * reported.
 *
 * At a block start, a tag one tab stop deep is indented code. Inside a
 * paragraph indented code cannot open, so a tag there ends the paragraph at
 * any depth.
 *
 * @type {Recognizer}
 */
export const htmlBlockTag = {
  name: 'html-block-tag',
  interruptsParagraph: true,
  match(lines, at, { syntax, paragraph }) {
    const pattern =
      paragraph === null ? patterns(syntax).blockTag : TAG_AT_ANY_INDENT;
    return pattern.test(lines[at].text) ? { last: at } : null;
  },
};
