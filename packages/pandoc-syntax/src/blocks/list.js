// The lists CommonMark cannot read: definition lists, example lists, and
// fancy lists — ordered lists with any marker but a number and a period. Each
// is reported whole, from its first term or item to the last line that
// belongs to it.

import { BLANK } from '../lines.js';
import { CODE_INDENT } from './code.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').Context} Context */

// A definition's marker, indented at most two spaces.
const DEFINITION_MARKER = /^ {0,2}[:~][ \t]+\S/;
const EXAMPLE_ITEM = /^\(@[\w-]*\)[ \t]+\S/;
// A list resumes past a blank line on content indented under its items.
const INDENTED_CONTENT = /^( {2,}|\t)\S/;

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

/**
 * Whether a line opens an ordered list item, in any of Pandoc's styles.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isOrderedItem(text) {
  const marker = ORDERED_MARKER.exec(text);
  return marker !== null && marker.groups.indent.length < CODE_INDENT;
}

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
  return { last, after: 'start', spans: [{ type, from: at, to: last }] };
}

/**
 * Whether a definition list opens on line `at`: a one-line term, then its
 * marker, a blank line between them allowed. A line that opens a block of its
 * own, a heading say, is never a term.
 *
 * @param {Line[]} lines
 * @param {number} at
 * @param {Context} context
 */
function opensDefinitionList(lines, at, context) {
  const [next, after] = [lines[at + 1]?.text, lines[at + 2]?.text];
  if (BLANK.test(lines[at].text) || next === undefined) return false;
  if (context.opensBlock(lines, at)) return false;
  if (DEFINITION_MARKER.test(next)) return true;
  return BLANK.test(next) && DEFINITION_MARKER.test(after ?? '');
}

/** @type {Recognizer} */
export const definitionList = {
  name: 'definition-list',
  interruptsParagraph: false,
  match(lines, at, context) {
    if (!opensDefinitionList(lines, at, context)) return null;
    const resumes = (lines, n) =>
      INDENTED_CONTENT.test(lines[n].text) ||
      DEFINITION_MARKER.test(lines[n].text) ||
      opensDefinitionList(lines, n, context);
    return list('definition-list', lines, at, resumes);
  },
};

/** @type {Recognizer} */
export const exampleList = {
  name: 'example-list',
  interruptsParagraph: false,
  match(lines, at) {
    if (!EXAMPLE_ITEM.test(lines[at].text)) return null;
    const resumes = (lines, n) =>
      INDENTED_CONTENT.test(lines[n].text) || EXAMPLE_ITEM.test(lines[n].text);
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
  match(lines, at) {
    if (!isOrderedItem(lines[at].text)) return null;
    const resumes = (lines, n) =>
      INDENTED_CONTENT.test(lines[n].text) || isOrderedItem(lines[n].text);
    const last = listEnd(lines, at, resumes);
    const fancy = lines
      .slice(at, last + 1)
      .some((l) => ORDERED_MARKER.test(l.text) && !PLAIN_MARKER.test(l.text));
    return fancy
      ? {
          last,
          after: 'start',
          spans: [{ type: 'fancy-list', from: at, to: last }],
        }
      : null;
  },
};
