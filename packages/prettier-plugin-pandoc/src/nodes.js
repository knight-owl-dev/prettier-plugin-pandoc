// The nodes this plugin adds to prettier's markdown tree, beside the visitor
// keys prettier's traversal needs for each: the embed pass walks the tree and
// throws on a node type it has no keys for.

// A fenced div: its fence lines as written, and its body.
export const DIV = 'pandocDiv';
// A block printed exactly as written, container prefixes aside.
export const VERBATIM = 'pandocVerbatim';

export const VISITOR_KEYS = {
  [DIV]: ['children'],
  [VERBATIM]: [],
};

// Inline raw TeX, printed exactly as written: a code span marked so. It stays
// a code span to prettier, which joins a node's children by line breaks
// wherever one is a type it does not know as inline.
export const INLINE_RAW = 'pandocInlineRaw';
export const isInlineRaw = (node) =>
  node.type === 'inlineCode' && node[INLINE_RAW] === true;
