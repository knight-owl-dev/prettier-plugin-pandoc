// The nodes this plugin adds to prettier's markdown tree, beside the visitor
// keys prettier's traversal needs for each: the embed pass walks the tree and
// throws on a node type it has no keys for.

// A fenced div: its fence lines as written, and its body.
export const DIV = 'pandocDiv';
// A block printed exactly as written, container prefixes aside.
export const VERBATIM = 'pandocVerbatim';
// Two blocks kept a line apart: a paragraph and a verbatim block, or a
// definition list and any block. A blank line between would turn Pandoc's
// plain text into a paragraph.
export const JOINED = 'pandocJoined';

export const VISITOR_KEYS = {
  [DIV]: ['children'],
  [VERBATIM]: [],
  [JOINED]: ['children'],
};

// On the root: the recognizer's containers, whose content lines the printer
// reads the source through.
export const CONTAINERS = 'pandocContainers';

// Inline raw TeX, printed exactly as written: a code span marked so. It stays
// a code span to prettier, which joins a node's children by line breaks
// wherever one is a type it does not know as inline.
export const INLINE_RAW = 'pandocInlineRaw';
export const isInlineRaw = (node) =>
  node.type === 'inlineCode' && node[INLINE_RAW] === true;
