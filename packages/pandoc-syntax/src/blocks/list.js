// The lists CommonMark cannot read: example lists, and fancy lists — ordered
// lists with any marker but a number and a period. Each is reported whole,
// from its first item to the last line that belongs to it. Definition lists
// hold containers: `container.js`.

import { BLANK, indentOf } from '../lines.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../syntax.js').Syntax} Syntax */

// An example or fancy list resumes on content indented two columns or more:
// the narrowest an item's content sits, a one-character marker and its space.
// An item with a wider marker needs more, so a list can run past where Pandoc
// ends it. The span prints as written, which leaves those lines unchanged.
const NARROWEST_ITEM_CONTENT = 2;
const resumesItem = (text, syntax) =>
  !BLANK.test(text) && indentOf(text, syntax.tabStop) >= NARROWEST_ITEM_CONTENT;

// An example list marker: an `@`, a label after it and a count before it both
// optional, in parentheses or closed by a period or a parenthesis.
//
//   (@) (@good) (3@) (3@good)   @. @good. 3@.   @) @good) 3@)
//
// `indent` is how far in the marker sits.
const EXAMPLE_MARKER =
  /^(?<indent>[ \t]*)(?:\(\d*@[\w-]*\)|\d*@[\w-]*[.)])(?:[ \t]+\S|[ \t]*$)/;

// An ordered list marker, in any of Pandoc's styles:
//
//   (1) (a) (A) (iv) (IV) (#)   wrapped in parentheses
//   1. a. iv. #.   1) a) iv) #)   closed by a period or a parenthesis
//   A) IV)                        a capital closed by a parenthesis
//   A.  IV.                       a capital closed by a period needs two spaces
//                                 after it, so an initial opening a sentence
//                                 stays prose
//
// `indent` is how far in the marker sits.
// cspell:ignore ivxlcdm IVXLCDM
const ORDERED_MARKER =
  /^(?<indent>[ \t]*)(?:\((?:\d+|[a-zA-Z]|[ivxlcdm]+|[IVXLCDM]+|#)\)|(?:\d+|[a-z]|[ivxlcdm]+|#)[.)]|[A-Z]\)|[IVXLCDM]+\)|(?:[A-Z]|[IVXLCDM]+)\.(?= {2}|\t))(?:[ \t]+\S|[ \t]*$)/;
// The one marker style prettier prints as Pandoc reads it.
const PLAIN_MARKER = /^[ \t]*\d+\.[ \t]/;

// Whether `pattern` finds a list marker on the line, short of indented code.
function opensItem(pattern, text, syntax) {
  const marker = pattern.exec(text);
  return (
    marker !== null &&
    indentOf(marker.groups.indent, syntax.tabStop) < syntax.codeIndent
  );
}

const isExampleItem = (text, syntax) => opensItem(EXAMPLE_MARKER, text, syntax);

/**
 * Whether a line opens an ordered list item, in any of Pandoc's styles.
 *
 * @param {string} text
 * @param {Syntax} syntax
 * @returns {boolean}
 */
export const isOrderedItem = (text, syntax) =>
  opensItem(ORDERED_MARKER, text, syntax);

// The last line of a list opening on line `at`. Every non-blank line straight
// after an item continues it, lazily or not; past a blank line the list goes on
// only where `resumes` says the next non-blank line belongs to it.
function listEnd(lines, at, resumes) {
  let last = at;
  for (let n = at + 1; n < lines.length; n++) {
    if (BLANK.test(lines[n].text)) continue;
    if (!BLANK.test(lines[n - 1].text) || resumes(lines, n)) last = n;
    else break;
  }
  return last;
}

// A whole list, reported as one span.
function list(type, lines, at, resumes) {
  const last = listEnd(lines, at, resumes);
  return { last, spans: [{ type, from: at, to: last }] };
}

/** @type {Recognizer} */
export const exampleList = {
  name: 'example-list',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    if (!isExampleItem(lines[at].text, syntax)) return null;
    const resumes = (lines, n) =>
      resumesItem(lines[n].text, syntax) ||
      isExampleItem(lines[n].text, syntax);
    return list('example-list', lines, at, resumes);
  },
};

/**
 * An ordered list is fancy when any item, however deep, carries a marker
 * prettier would rewrite or not read as one.
 *
 * @type {Recognizer}
 */
export const fancyList = {
  name: 'fancy-list',
  interruptsParagraph: false,
  match(lines, at, { syntax }) {
    if (!isOrderedItem(lines[at].text, syntax)) return null;
    const resumes = (lines, n) =>
      resumesItem(lines[n].text, syntax) ||
      isOrderedItem(lines[n].text, syntax);
    const last = listEnd(lines, at, resumes);
    const fancy = lines
      .slice(at, last + 1)
      .some((l) => ORDERED_MARKER.test(l.text) && !PLAIN_MARKER.test(l.text));
    return fancy
      ? {
          last,
          spans: [{ type: 'fancy-list', from: at, to: last }],
        }
      : null;
  },
};
