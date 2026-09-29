// A prettier plugin that formats Pandoc markdown without breaking its syntax.
//
// Prettier's markdown parser is CommonMark, which folds Pandoc's block
// constructs into the paragraph around them and reads markdown inside its raw
// TeX. This plugin keeps prettier's own parser and printer, and settles only
// where Pandoc's constructs are:
//
//   1. @knight-owl-dev/pandoc-syntax finds each one by Pandoc's rules.
//   2. Each is masked in place (mask.js), so every offset stays true to the
//      source and the stock parser sees what Pandoc sees there.
//   3. The masked constructs become nodes of this plugin's own (settle.js),
//      which the wrapped printer prints (print.js); every other node prints
//      as stock.
//
// Preserve, never repair: markup Pandoc reads as broken stays as written,
// since repairing it would change what the document means.

import * as markdown from 'prettier/plugins/markdown';
import { VISITOR_KEYS } from './nodes.js';
import { parse } from './parse.js';
import { print } from './print.js';

const AST_FORMAT = 'mdast-pandoc';
const mdast = markdown.printers.mdast;

function getVisitorKeys(node, nonTraversableKeys) {
  return (
    VISITOR_KEYS[node.type] ?? mdast.getVisitorKeys(node, nonTraversableKeys)
  );
}

export const parsers = {
  markdown: { ...markdown.parsers.markdown, parse, astFormat: AST_FORMAT },
};

export const printers = {
  [AST_FORMAT]: { ...mdast, print, getVisitorKeys },
};

export default { parsers, printers };
