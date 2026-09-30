// Pandoc's block constructs, in the order a line is offered to them.
//
// At a block start the first recognizer to match a line claims it, so the
// order is Pandoc's precedence. Where a paragraph would continue into the line,
// only those that interrupt a paragraph are asked, in the same order.

import { fencedCode, indentedCode } from './code.js';
import { blockQuote, footnoteDefinition, listItem } from './container.js';
import { divOpen } from './div.js';
import { atxHeading, setextUnderline, thematicBreak } from './heading.js';
import { htmlBlockTag, htmlComment } from './html.js';
import { lineBlock } from './line-block.js';
import { definitionList, exampleList, fancyList } from './list.js';
import { texBlock, texEnvironmentInParagraph } from './raw-tex.js';
import { linkReference } from './reference.js';
import { pandocTable, pipeTable } from './table.js';
import { yamlMetadata } from './yaml.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */

/** @type {Recognizer[]} */
export const REGISTRY = [
  // Those that interrupt a paragraph. A fence claims its lines before
  // anything else can read inside them.
  fencedCode,
  setextUnderline,
  htmlBlockTag,

  // The rest open only at a block start.
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
  // A line one tab stop deep is code, except where it opens a table: Pandoc
  // tries tables first, and a simple table's header may sit that deep.
  indentedCode,
  // After the tables and indented code Pandoc tries first: a table's first
  // cell may be raw TeX. Before the rest, which could read inside its lines.
  texBlock,
  lineBlock,
  blockQuote,
  // Before the list item a `* * *` or `- - -` would otherwise open.
  thematicBreak,
  listItem,
  footnoteDefinition,
  atxHeading,
  htmlComment,
  linkReference,
  // Last, and in a paragraph too: a line is paragraph text only where nothing
  // else opens on it.
  texEnvironmentInParagraph,
];

export const INTERRUPTERS = REGISTRY.filter((r) => r.interruptsParagraph);

// In a list item's content a list may open straight after a paragraph line too.
const LISTS = new Set([exampleList, fancyList, listItem]);
export const ITEM_INTERRUPTERS = REGISTRY.filter(
  (r) => r.interruptsParagraph || LISTS.has(r),
);
