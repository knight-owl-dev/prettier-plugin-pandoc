// Containers: block quotes, list items, footnote definitions, and a
// definition list's definitions. Pandoc collects a container's lines first
// and parses the text as a document of its own, so which lines belong to it
// follows the text, not what each line continues — a line without its prefix
// is lazy, taken whatever it follows.
// Inside a div, a closing fence is the div's, never a lazy line.
//
// Each recognizer returns the container's content as views of its lines, for
// the scan to read in turn.

import { BLANK, dedent, indentOf, strip } from '../lines.js';
import { perSyntax } from '../syntax.js';
import { fencedCode } from './code.js';
import { DIV_CLOSE } from './div.js';
import { isThematicBreak } from './heading.js';
import { isOrderedItem } from './list.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').Context} Context */
/** @typedef {import('../types.js').Match} Match */

// Each container's marker; a list item's and a definition's with their
// indentation and gap. Pandoc caps an ordered marker at nine digits, as
// CommonMark does.
const patterns = perSyntax(({ blockIndent }) => ({
  quoteMarker: new RegExp(`^ {0,${blockIndent}}> ?`),
  footnoteMarker: new RegExp(`^ {0,${blockIndent}}\\[\\^[^\\]\\s]+\\]:[ \\t]*`),
  bulletItem: new RegExp(`^( {0,${blockIndent}})([-*+])([ \\t]+|$)`),
  plainItem: new RegExp(`^( {0,${blockIndent}})(\\d{1,9}\\.)([ \\t]+|$)`),
  definitionMarker: new RegExp(`^( {0,${blockIndent}})([:~])([ \\t]+|$)`),
}));

const isListMarker = (text, syntax) =>
  patterns(syntax).bulletItem.test(text) ||
  patterns(syntax).plainItem.test(text) ||
  isOrderedItem(text, syntax);

const isDefinitionMarker = (text, syntax) =>
  patterns(syntax).definitionMarker.test(text);

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
      containers: [{ type: 'block-quote', from: at, to: n - 1, content }],
    };
  },
};

// The widest gap an item's content follows: Pandoc takes a column after the
// marker, then up to three more, whatever the tab stop.
const WIDEST_GAP = 4;

// The column an item's content starts at, and how many characters of its
// first line come before it. The content follows the gap after the marker,
// except that a wider gap is one column of gap and then the content's own
// indentation, and a marker with nothing after it puts the column one past.
function contentColumn(line, [prefix, indent, marker, gap], syntax) {
  const rest = line.text.slice(prefix.length);
  const at = indent.length + marker.length;
  const columns = indentOf(' '.repeat(at) + gap, syntax.tabStop) - at;
  const width = BLANK.test(rest) || columns > WIDEST_GAP ? 1 : columns;
  return { column: at + width, first: at + Math.min(width, gap.length) };
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
 * @param {(n: number) => boolean} endsLazily
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
    } else if (n > last + 1 || endsLazily(n)) {
      break;
    } else {
      content.push({ ...dedent(line, indent, tabStop), lazy: true });
    }
    last = n;
  }
  return { last, content };
}

/**
 * The body of a list item or a definition, its marker on line `at`. A line
 * that would be lazy ends it where it opens a list, a definition among them —
 * a thematic break is none — or a fence. Pandoc takes an item's lines first up
 * to a blank line, a fence, or a list on a content line however deep; past
 * one, a fence is lazy text.
 *
 * @param {Line[]} lines
 * @param {number} at
 * @param {RegExpExecArray} marker
 * @param {Context} context
 */
function itemBody(lines, at, marker, context) {
  const { inDiv, syntax } = context;
  const { column, first } = contentColumn(lines[at], marker, syntax);
  const opensList = (text) =>
    (isListMarker(text, syntax) && !isThematicBreak(text, syntax)) ||
    isDefinitionMarker(text, syntax);
  const opensFence = (n) =>
    fencedCode.match(lines, n, { ...context, paragraph: null }) !== null;
  const ends = (k) =>
    BLANK.test(lines[k].text) ||
    (indentOf(lines[k].text, syntax.tabStop) >= column &&
      opensList(lines[k].text.trimStart())) ||
    opensFence(k);
  const firstTake = (n) => {
    for (let k = at + 1; k < n; k++) if (ends(k)) return false;
    return true;
  };
  const endsLazily = (n) =>
    opensList(lines[n].text) ||
    (opensFence(n) && firstTake(n)) ||
    (inDiv && DIV_CLOSE.test(lines[n].text));
  return collectBody(lines, at, first, column, endsLazily, syntax.tabStop);
}

/** @type {Recognizer} */
export const listItem = {
  name: 'list-item',
  interruptsParagraph: false,
  match(lines, at, context) {
    const { bulletItem, plainItem } = patterns(context.syntax);
    const marker =
      bulletItem.exec(lines[at].text) ?? plainItem.exec(lines[at].text);
    if (marker === null) return null;
    const { last, content } = itemBody(lines, at, marker, context);
    return {
      last,
      containers: [{ type: 'list-item', from: at, to: last, content }],
    };
  },
};

// The definition marker after a term on line `at`, past at most `blanks`
// blank lines, or -1.
function markerAfter(lines, at, syntax, blanks = Infinity) {
  let n = at + 1;
  while (n < lines.length && n - at <= blanks && BLANK.test(lines[n].text)) {
    n++;
  }
  return n < lines.length && isDefinitionMarker(lines[n].text, syntax) ? n : -1;
}

/**
 * A definition list: terms, each a line, and their definitions, each read as
 * a list item. The first term is a line opening no block of its own, one
 * blank line at most before its marker; a later one is any line.
 *
 * @type {Recognizer}
 */
export const definitionList = {
  name: 'definition-list',
  interruptsParagraph: false,
  match(lines, at, context) {
    const { syntax } = context;
    if (BLANK.test(lines[at].text) || context.opensBlock(lines, at)) {
      return null;
    }
    /** @type {NonNullable<Match['containers']>} */
    const containers = [];
    let last = at;
    for (let n = markerAfter(lines, at, syntax, 1); n !== -1; ) {
      const marker = patterns(syntax).definitionMarker.exec(lines[n].text);
      const { last: end, content } = itemBody(lines, n, marker, context);
      containers.push({ type: 'definition', from: n, to: end, content });
      last = end;
      let next = last + 1;
      while (next < lines.length && BLANK.test(lines[next].text)) next++;
      if (next === lines.length) break;
      n = isDefinitionMarker(lines[next].text, syntax)
        ? next
        : markerAfter(lines, next, syntax);
    }
    return containers.length === 0
      ? null
      : {
          last,
          spans: [{ type: 'definition-list', from: at, to: last }],
          containers,
        };
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
    const endsLazily = (n) =>
      footnoteMarker.test(lines[n].text) ||
      (inDiv && DIV_CLOSE.test(lines[n].text));
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
      containers: [
        { type: 'footnote-definition', from: at, to: last, content },
      ],
    };
  },
};
