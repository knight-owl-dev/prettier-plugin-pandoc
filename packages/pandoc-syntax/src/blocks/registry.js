// Pandoc's block constructs, in the order a line is offered to them.
//
// At a block start the first recognizer to match a line claims it, so the
// order is Pandoc's precedence. Where a paragraph would continue into the line,
// only those that interrupt a paragraph are asked, in the same order.
//
// Every pattern allows up to three spaces of indentation where a block may
// start (` {0,3}`): four make a line indented code.

import { fencedCode, indentedCode } from './code.js';
import { blockQuote, footnoteDefinition, listItem } from './container.js';
import { divOpen } from './div.js';
import { atxHeading, setextUnderline, thematicBreak } from './heading.js';
import { htmlBlockTag, htmlComment } from './html.js';
import { lineBlock } from './line-block.js';
import { definitionList, exampleList, fancyList } from './list.js';
import { texCommandLine, texEnvironment } from './raw-tex.js';
import { linkReference } from './reference.js';
import { pandocTable, pipeTable } from './table.js';
import { yamlMetadata } from './yaml.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

/** @type {Recognizer[]} */
export const REGISTRY = [
  // The four that interrupt a paragraph. A fence and an environment claim
  // their lines before anything else can read inside them.
  fencedCode,
  texEnvironment,
  setextUnderline,
  htmlBlockTag,

  divOpen,
  // Before the thematic break and the tables its `---` would otherwise open.
  yamlMetadata,
  // Before the tables and lists a term or item line could also start.
  definitionList,
  exampleList,
  fancyList,
  // Before the thematic break a table's dash line would otherwise read as.
  pandocTable,
  pipeTable,
  // A line one tab stop deep is code, whatever else but a table it would
  // open: tables come first in Pandoc, each opening short of a tab stop.
  indentedCode,
  lineBlock,
  texCommandLine,
  blockQuote,
  // Before the list item a `* * *` or `- - -` would otherwise open.
  thematicBreak,
  listItem,
  footnoteDefinition,
  atxHeading,
  htmlComment,
  linkReference,
];

export const INTERRUPTERS = REGISTRY.filter((r) => r.interruptsParagraph);
