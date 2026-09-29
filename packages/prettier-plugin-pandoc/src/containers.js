// Containers the two parsers bound differently.
//
// Pandoc collects a block quote's or list item's lines first and parses them
// as a document of its own, so a line without its prefix belongs to the
// container whatever it follows. CommonMark decides line by line and continues
// a container lazily only into paragraph text, so after a heading or a fence
// its tree can part from Pandoc's. Where they part, the container prints as
// written — decided by comparing the trees, never predicted.

import { lineSpans } from './text.js';

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */

// The node prettier's parser makes for each of the recognizer's containers.
const NODE_TYPE = { 'block-quote': 'blockquote', 'list-item': 'listItem' };
const NODE_TYPES = new Set(Object.values(NODE_TYPE));

/**
 * @param {Block} block
 * @returns {boolean}
 */
export const isContainer = (block) => NODE_TYPE[block.type] !== undefined;

const within = (inner, outer) =>
  inner !== outer && inner.start >= outer.start && inner.end <= outer.end;

/**
 * Every container node of prettier's tree, in document order, a parent before
 * its children.
 *
 * @param {object} node
 * @param {object[]} [out]
 * @returns {object[]}
 */
export function containerNodes(node, out = []) {
  if (NODE_TYPES.has(node.type)) out.push(node);
  for (const child of node.children ?? []) containerNodes(child, out);
  return out;
}

/**
 * The first container prettier's parser bounds where Pandoc does not, or
 * undefined. Each is found by where its marker sits. Their ends agree when all
 * between them is what the masks blanked, a quote's bare `>` included.
 *
 * @param {Block[]} containers
 * @param {object} ast
 * @param {string} text
 * @param {string} masked
 * @returns {Block | undefined}
 */
export function firstMisread(containers, ast, text, masked) {
  const byMarker = new Map(
    containerNodes(ast).map((n) => [`${n.type}@${n.position.start.offset}`, n]),
  );
  return containers.find((container) => {
    const indent = /^[ \t]*/.exec(text.slice(container.start))[0].length;
    const marker = container.start + indent;
    const node = byMarker.get(`${NODE_TYPE[container.type]}@${marker}`);
    if (node === undefined) return true;
    const end = node.position.end.offset;
    return (
      end > container.end || !/^[\s>]*$/.test(masked.slice(end, container.end))
    );
  });
}

// The start and end of the list a top-level item belongs to: every top-level
// item beside it with only blank lines between.
function listAround(item, top, text) {
  const adjacent = (a, b) =>
    a.type === 'list-item' &&
    b.type === 'list-item' &&
    /^\s*$/.test(text.slice(a.end, b.start));
  let [first, last] = [top.indexOf(item), top.indexOf(item)];
  while (first > 0 && adjacent(top[first - 1], top[first])) first--;
  while (last + 1 < top.length && adjacent(top[last], top[last + 1])) last++;
  return { start: top[first].start, end: top[last].end };
}

/**
 * The stretch of the document a misread container sits in, as a verbatim
 * block: its outermost container, and for a list item the whole list. No
 * smaller piece of it reads the same to both parsers.
 *
 * @param {Block} container
 * @param {Block[]} containers
 * @param {string} text
 * @returns {Block}
 */
export function stretchOf(container, containers, text) {
  const top = containers.filter((c) => !containers.some((o) => within(c, o)));
  const outermost = top.find((c) => c === container || within(container, c));
  const { start, end } =
    outermost.type === 'list-item'
      ? listAround(outermost, top, text)
      : outermost;
  return {
    type: 'verbatim',
    start,
    end,
    segments: lineSpans(text, start, end),
  };
}
