// Code prettier's parser reads where Pandoc reads something else.
//
// CommonMark opens a fence wherever one starts a line, and runs one never
// closed to the end of its container. Pandoc reads a fence never closed as
// text, and lets only a backtick fence interrupt a paragraph. Indented code
// Pandoc reads is masked before prettier parses, so any indented code prettier
// finds is CommonMark's alone: text at a wider tab stop, or a fence deeper
// than a list item's content. Where the two part, the code prints as written
// — found by comparing the trees, never predicted.

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

// Every code node, in document order.
function codeNodes(node, out = []) {
  for (const child of node.children ?? []) {
    if (child.type === 'code') out.push(child);
    codeNodes(child, out);
  }
  return out;
}

/**
 * Where the first code Pandoc does not read as prettier did starts, or
 * undefined.
 *
 * @param {object} ast
 * @param {Block[]} found What the recognizer found in the source.
 * @param {string} text
 * @returns {number | undefined}
 */
export function firstUnreadCode(ast, found, text) {
  const fences = new Set(
    found
      .filter((block) => block.type === 'fenced-code')
      .map((block) => lineOf(text, block.start)),
  );
  return codeNodes(ast).find(
    (node) => node.isIndented || !fences.has(node.position.start.line),
  )?.position.start.offset;
}
