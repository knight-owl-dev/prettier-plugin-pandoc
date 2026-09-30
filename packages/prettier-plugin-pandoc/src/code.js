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

// Every fenced code node, with its siblings.
function fencedCode(node, out = []) {
  (node.children ?? []).forEach((child, index) => {
    if (child.type === 'code' && !child.isIndented) {
      out.push({ node: child, siblings: node.children, index });
    }
    fencedCode(child, out);
  });
  return out;
}

// Whether two siblings sit on adjacent lines, no blank line between.
const joined = (a, b) => a.position.end.line + 1 === b.position.start.line;

/**
 * The stretch around the first fenced code Pandoc does not read as code, as
 * a verbatim block, or undefined. The blocks joined to it with no blank line
 * between, before or after, are one paragraph with it to Pandoc and print as
 * written too; in a container, the container's stretch does.
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

  const { node, siblings, index } = unread;
  const holder = containers.find(
    (c) =>
      c.start <= node.position.start.offset &&
      node.position.end.offset <= c.end,
  );
  if (holder !== undefined) return stretchOf(holder, containers, text);

  let [first, last] = [index, index];
  while (first > 0 && joined(siblings[first - 1], siblings[first])) first--;
  while (
    last + 1 < siblings.length &&
    joined(siblings[last], siblings[last + 1])
  )
    last++;
  const start = lineStart(text, siblings[first].position.start.offset);
  // A fence never closed runs through the file's last newline, which the
  // printer writes again.
  const until = siblings[last].position.end.offset;
  const end = start + text.slice(start, until).trimEnd().length;
  return {
    type: 'verbatim',
    start,
    end,
    segments: lineSpans(text, start, end),
  };
}
