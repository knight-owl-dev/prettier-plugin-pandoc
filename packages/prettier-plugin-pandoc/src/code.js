// Code prettier's parser reads where Pandoc reads text.
//
// CommonMark opens a fence wherever one starts a line, and runs one never
// closed to the end of its container. Pandoc reads a fence never closed as
// text, and lets only a backtick fence interrupt a paragraph. Where the two
// part, the code prints as written — found by comparing the trees, never
// predicted.

import { stretchOf } from './containers.js';
import { lineSpans } from './text.js';

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
const lineStart = (text, offset) => text.lastIndexOf('\n', offset - 1) + 1;

// Every fenced code node, with the sibling before it.
function fencedCode(node, out = []) {
  (node.children ?? []).forEach((child, i) => {
    if (child.type === 'code' && !child.isIndented) {
      out.push({ node: child, previous: node.children[i - 1] });
    }
    fencedCode(child, out);
  });
  return out;
}

/**
 * The stretch around the first fenced code Pandoc does not read as code, as
 * a verbatim block, or undefined. A block the fence follows with no blank
 * line between is Pandoc's text with it, and prints as written too; in a
 * container, the container's stretch does.
 *
 * @param {object} ast
 * @param {Block[]} found What the recognizer found in `text`.
 * @param {Block[]} containers
 * @param {string} text
 * @returns {Block | undefined}
 */
export function firstUnreadCode(ast, found, containers, text) {
  const fences = new Set(
    found
      .filter((block) => block.type === 'fenced-code')
      .map((block) => lineOf(text, block.start)),
  );
  const unread = fencedCode(ast).find(
    ({ node }) => !fences.has(node.position.start.line),
  );
  if (unread === undefined) return undefined;

  const { node, previous } = unread;
  const holder = containers.find(
    (c) =>
      c.start <= node.position.start.offset &&
      node.position.end.offset <= c.end,
  );
  if (holder !== undefined) return stretchOf(holder, containers, text);

  const joined =
    previous !== undefined &&
    previous.position.end.line + 1 === node.position.start.line;
  const start = lineStart(
    text,
    (joined ? previous : node).position.start.offset,
  );
  // A fence never closed runs through the file's last newline, which the
  // printer writes again.
  const end =
    start + text.slice(start, node.position.end.offset).trimEnd().length;
  return {
    type: 'verbatim',
    start,
    end,
    segments: lineSpans(text, start, end),
  };
}
