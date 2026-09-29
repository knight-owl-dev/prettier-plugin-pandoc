// Containers: block quotes and list items. Pandoc collects a container's lines
// first and parses the text as a document of its own, so which lines belong to
// it follows the text, not what each line continues — a line without its
// prefix is lazy, taken whatever it follows. Inside a div, a closing fence is
// the div's, never a lazy line.
//
// Each recognizer returns the container's content as views of its lines, for
// the scan to read in turn.

import { BLANK, dedent, indentOf, strip } from '../lines.js';
import { CODE_INDENT } from './code.js';
import { DIV_CLOSE } from './div.js';
import { THEMATIC_BREAK } from './heading.js';
import { isOrderedItem } from './list.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */

const QUOTE_MARKER = /^ {0,3}> ?/;
const BULLET_ITEM = /^( {0,3})([-*+])([ \t]+|$)/;
// CommonMark caps an ordered marker at nine digits.
const PLAIN_ITEM = /^( {0,3})(\d{1,9}\.)([ \t]+|$)/;

const isListMarker = (text) =>
  BULLET_ITEM.test(text) || PLAIN_ITEM.test(text) || isOrderedItem(text);

/**
 * A block quote runs to its first blank line, a `>` stripped from each line
 * that has one.
 *
 * @type {Recognizer}
 */
export const blockQuote = {
  name: 'block-quote',
  interruptsParagraph: false,
  match(lines, at, { inDiv }) {
    if (!QUOTE_MARKER.test(lines[at].text)) return null;
    const content = [];
    let n = at;
    for (; n < lines.length && !BLANK.test(lines[n].text); n++) {
      const marker = QUOTE_MARKER.exec(lines[n].text);
      if (marker === null && inDiv && DIV_CLOSE.test(lines[n].text)) break;
      content.push(
        marker === null
          ? { ...lines[n], lazy: true }
          : strip(lines[n], marker[0].length),
      );
    }
    return {
      last: n - 1,
      after: 'start',
      container: { type: 'block-quote', content },
    };
  },
};

// The column an item's content starts at, and how many characters of its
// first line come before it. The content follows the gap after the marker,
// except that five columns of gap or more is one column of gap and then
// indented code, and a marker with nothing after it puts the column one past.
function contentColumn(line, [prefix, indent, marker, gap]) {
  const rest = line.text.slice(prefix.length);
  const width =
    BLANK.test(rest) || indentOf(gap) > CODE_INDENT ? 1 : indentOf(gap);
  return {
    column: indent.length + marker.length + width,
    first: indent.length + marker.length + Math.min(width, gap.length),
  };
}

/**
 * A list item. Straight after a content line, any line continues it but a list
 * marker left of the content column, which opens the next item, or a
 * thematic break; past a blank line, only a line indented to the column does.
 * Blank lines the item ends on belong to what follows.
 *
 * @type {Recognizer}
 */
export const listItem = {
  name: 'list-item',
  interruptsParagraph: false,
  match(lines, at, { inDiv }) {
    const marker =
      BULLET_ITEM.exec(lines[at].text) ?? PLAIN_ITEM.exec(lines[at].text);
    if (marker === null) return null;
    const { column, first } = contentColumn(lines[at], marker);
    const content = [strip(lines[at], first)];
    let last = at;
    for (let n = at + 1; n < lines.length; n++) {
      const line = lines[n];
      if (BLANK.test(line.text)) continue;
      const indent = indentOf(line.text);
      if (indent >= column) {
        // Blank lines between content lines are the item's own.
        for (let b = last + 1; b < n; b++) {
          content.push(dedent(lines[b], column));
        }
        content.push(dedent(line, column));
      } else if (
        n > last + 1 ||
        isListMarker(line.text) ||
        THEMATIC_BREAK.test(line.text) ||
        (inDiv && DIV_CLOSE.test(line.text))
      ) {
        break;
      } else {
        content.push({ ...dedent(line, indent), lazy: true });
      }
      last = n;
    }
    return {
      last,
      after: 'start',
      container: { type: 'list-item', content },
    };
  },
};
