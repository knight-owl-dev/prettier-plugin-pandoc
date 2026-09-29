// The nodes this plugin adds to prettier's markdown tree, beside the visitor
// keys prettier's traversal needs for each: the embed pass walks the tree and
// throws on a node type it has no keys for.

// A fenced div: its fence lines as written, and its body.
export const DIV = 'pandocDiv';
// A block printed exactly as written, container prefixes aside.
export const VERBATIM = 'pandocVerbatim';
// Inline raw TeX, printed exactly as written.
export const INLINE_RAW = 'pandocInlineRaw';

export const VISITOR_KEYS = {
  [DIV]: ['children'],
  [VERBATIM]: [],
  [INLINE_RAW]: [],
};
