// Containers: block quotes, list items and footnote definitions. Pandoc
// collects a container's lines first and parses the text as a document of its
// own, so which lines belong to it follows the text, not what each line
// continues — a line without its prefix is lazy, taken whatever it follows.
// Inside a div, a closing fence is the div's, never a lazy line.
//
// Each recognizer returns the container's content as views of its lines, for
// the scan to read in turn.

import { BLANK, dedent, indentOf, strip } from '../lines.js';
import { perSyntax } from '../syntax.js';
import { DIV_CLOSE } from './div.js';
import { isThematicBreak } from './heading.js';
import { isDefinitionMarker, isOrderedItem } from './list.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */

// Each container's marker; a list item's with its indentation and gap. Pandoc
// caps an ordered marker at nine digits, as CommonMark does.
const patterns = perSyntax(({ blockIndent }) => ({
  quoteMarker: new RegExp(`^ {0,${blockIndent}}> ?`),
  footnoteMarker: new RegExp(`^ {0,${blockIndent}}\\[\\^[^\\]\\s]+\\]:[ \\t]*`),
  bulletItem: new RegExp(`^( {0,${blockIndent}})([-*+])([ \\t]+|$)`),
  plainItem: new RegExp(`^( {0,${blockIndent}})(\\d{1,9}\\.)([ \\t]+|$)`),
}));

const isListMarker = (text, syntax) =>
  patterns(syntax).bulletItem.test(text) ||
  patterns(syntax).plainItem.test(text) ||
  isOrderedItem(text, syntax);

/**
 * A block quote runs to its first blank line, a `>` stripped from each line
 * that has one.
 *
 * @type {Recognizer}
 */
export const blockQuote = {
  name: 'block-quote',
  interruptsParagraph: false,
  match(lines, at, { inDiv, syntax }) {
    const { quoteMarker } = patterns(syntax);
    if (!quoteMarker.test(lines[at].text)) return null;
    const content = [];
    let n = at;
    for (; n < lines.length && !BLANK.test(lines[n].text); n++) {
      const marker = quoteMarker.exec(lines[n].text);
      if (marker === null && inDiv && DIV_CLOSE.test(lines[n].text)) break;
      content.push(
        marker === null
          ? { ...lines[n], lazy: true }
          : strip(lines[n], marker[0].length),
      );
    }
    return {
      last: n - 1,
      container: { type: 'block-quote', content },
    };
  },
};

// The column an item's content starts at, and how many characters of its
// first line come before it. The content follows the gap after the marker,
// except that a gap wider than a code indent is one column of gap and then
// indented code, and a marker with nothing after it puts the column one past.
function contentColumn(line, [prefix, indent, marker, gap], syntax) {
  const rest = line.text.slice(prefix.length);
  const columns = indentOf(gap, syntax.tabStop);
  const width = BLANK.test(rest) || columns > syntax.codeIndent ? 1 : columns;
  return {
    column: indent.length + marker.length + width,
    first: indent.length + marker.length + Math.min(width, gap.length),
  };
}

/**
 * A body read from its first line on: `first` characters of that line precede
 * its content, which later lines continue at `column`. Straight after a content
 * line, any line continues it lazily unless `endsLazily` says it opens
 * something else; past a blank line, only a line indented to the column does.
 * Blank lines the body ends on belong to what follows.
 *
 * @param {Line[]} lines
 * @param {number} at
 * @param {number} first
 * @param {number} column
 * @param {(text: string) => boolean} endsLazily
 * @param {number} tabStop
 * @returns {{last: number, content: Line[]}}
 */
function collectBody(lines, at, first, column, endsLazily, tabStop) {
  const content = [strip(lines[at], first)];
  let last = at;
  for (let n = at + 1; n < lines.length; n++) {
    const line = lines[n];
    if (BLANK.test(line.text)) continue;
    const indent = indentOf(line.text, tabStop);
    if (indent >= column) {
      // Blank lines between content lines are the body's own.
      for (let b = last + 1; b < n; b++) {
        content.push(dedent(lines[b], column, tabStop));
      }
      content.push(dedent(line, column, tabStop));
    } else if (n > last + 1 || endsLazily(line.text)) {
      break;
    } else {
      content.push({ ...dedent(line, indent, tabStop), lazy: true });
    }
    last = n;
  }
  return { last, content };
}

/**
 * A list item. A line that would be lazy ends the item where it opens with a
 * list marker, a definition's among them; a thematic break is none.
 *
 * @type {Recognizer}
 */
export const listItem = {
  name: 'list-item',
  interruptsParagraph: false,
  match(lines, at, { inDiv, syntax }) {
    const { bulletItem, plainItem } = patterns(syntax);
    const marker =
      bulletItem.exec(lines[at].text) ?? plainItem.exec(lines[at].text);
    if (marker === null) return null;
    const { column, first } = contentColumn(lines[at], marker, syntax);
    const endsLazily = (text) =>
      (isListMarker(text, syntax) && !isThematicBreak(text, syntax)) ||
      isDefinitionMarker(text, syntax) ||
      (inDiv && DIV_CLOSE.test(text));
    const { last, content } = collectBody(
      lines,
      at,
      first,
      column,
      endsLazily,
      syntax.tabStop,
    );
    return { last, container: { type: 'list-item', content } };
  },
};

/**
 * A footnote definition, `[^label]:` and its body. Its content column is one
 * tab stop in, whatever the label's width; another definition ends it where it
 * would otherwise be lazy.
 *
 * @type {Recognizer}
 */
export const footnoteDefinition = {
  name: 'footnote-definition',
  interruptsParagraph: false,
  match(lines, at, { inDiv, syntax }) {
    const { footnoteMarker } = patterns(syntax);
    const marker = footnoteMarker.exec(lines[at].text);
    if (marker === null) return null;
    const endsLazily = (text) =>
      footnoteMarker.test(text) || (inDiv && DIV_CLOSE.test(text));
    const { last, content } = collectBody(
      lines,
      at,
      marker[0].length,
      syntax.codeIndent,
      endsLazily,
      syntax.tabStop,
    );
    return {
      last,
      container: { type: 'footnote-definition', content },
    };
  },
};
