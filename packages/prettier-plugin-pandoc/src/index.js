// A prettier plugin that formats Pandoc markdown without changing what Pandoc
// reads.
//
// @knight-owl-llc/pandoc-parser reads the document as Pandoc does; the
// printer takes structure from that AST and text from the source each node
// spans, so the author's syntax survives what the AST drops. The output is
// read again, and what reads differently prints as written (check.js).

import { DEFAULT_TAB_STOP } from '@knight-owl-llc/pandoc-parser';
import { parse } from './parse.js';
import { embed, print } from './print.js';

const AST_FORMAT = 'pandoc';

// Match what the documents are built with: every indentation rule follows it.
export const options = {
  pandocTabStop: {
    type: 'int',
    category: 'Pandoc',
    default: DEFAULT_TAB_STOP,
    description:
      "Pandoc's --tab-stop: the columns a tab advances to, and the indentation that makes code.",
    range: { start: 1, end: Number.POSITIVE_INFINITY, step: 1 },
  },
};

const locStart = (node) => node.start;
const locEnd = (node) => node.end;

export const parsers = {
  markdown: { parse, astFormat: AST_FORMAT, locStart, locEnd },
};

export const printers = {
  [AST_FORMAT]: { print, embed, getVisitorKeys: () => [] },
};

export default { options, parsers, printers };
