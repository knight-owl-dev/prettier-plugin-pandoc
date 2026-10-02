// Containers the two parsers bound differently.
//
// Pandoc collects a container's lines first and parses them as a document of
// its own, so a line without its prefix belongs to the container whatever it
// follows. CommonMark decides line by line and continues
// a container lazily only into paragraph text, so after a heading or a fence
// its tree can part from Pandoc's. Where they part, the container prints as
// written — decided by comparing the trees, never predicted.

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */

// The node prettier's parser makes for each of the recognizer's containers.
const NODE_TYPE = {
  'block-quote': 'blockquote',
  'list-item': 'listItem',
  'footnote-definition': 'footnoteDefinition',
};
const NODE_TYPES = new Set(Object.values(NODE_TYPE));

/**
 * @param {Block} block
 * @returns {boolean}
 */
export const isContainer = (block) => NODE_TYPE[block.type] !== undefined;

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
 * Where the first container the two parsers bound differently sits, or
 * undefined: one of the recognizer's that prettier's parser bounds elsewhere,
 * or one of prettier's the recognizer never found. Each is found by where its
 * marker sits, and runs as far as either parser takes it. Their ends agree
 * when all between them is what the masks blanked, a quote's bare `>`
 * included.
 *
 * @param {Block[]} containers
 * @param {object} ast
 * @param {string} text
 * @param {string} masked
 * @returns {{start: number, end: number} | undefined}
 */
export function firstMisread(containers, ast, text, masked) {
  const markerOf = (container) =>
    container.start + /^[ \t]*/.exec(text.slice(container.start))[0].length;
  const nodes = containerNodes(ast);
  const byMarker = new Map(
    nodes.map((n) => [`${n.type}@${n.position.start.offset}`, n]),
  );
  const nodeOf = (container) =>
    byMarker.get(`${NODE_TYPE[container.type]}@${markerOf(container)}`);
  const bounded = new Set(
    containers.map((c) => `${NODE_TYPE[c.type]}@${markerOf(c)}`),
  );
  const parted = containers.find((container) => {
    const node = nodeOf(container);
    if (node === undefined) return true;
    const end = node.position.end.offset;
    return (
      end > container.end || !/^[\s>]*$/.test(masked.slice(end, container.end))
    );
  });
  const extra = nodes.find(
    (n) => !bounded.has(`${n.type}@${n.position.start.offset}`),
  );
  const misreads = [
    parted && {
      start: markerOf(parted),
      end: Math.max(parted.end, nodeOf(parted)?.position.end.offset ?? 0),
    },
    extra && {
      start: extra.position.start.offset,
      end: extra.position.end.offset,
    },
  ].filter(Boolean);
  if (misreads.length === 0) return undefined;
  return misreads.reduce((a, b) => (b.start < a.start ? b : a));
}
