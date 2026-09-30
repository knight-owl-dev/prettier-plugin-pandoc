// Blocks prettier's parser reads where Pandoc reads something else.
//
// CommonMark opens a fence wherever one starts a line, runs one never closed
// to the end of its container, and closes one only at three spaces' indent.
// Pandoc reads a fence never closed as text, lets only a backtick fence
// interrupt a paragraph, and closes one up to the tab stop. What Pandoc reads
// as indented code or a table is masked before prettier parses, so any
// indented code or table prettier finds is CommonMark's alone: text at a wider
// tab stop, a fence deeper than a list item's content, a table straight after
// a paragraph line. A fence Pandoc opens where CommonMark closes one parts
// them too. Where the two part, the block prints as written — found by
// comparing the trees, never predicted.

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

// Every block node Pandoc may read otherwise, in document order.
const SUSPECT = new Set(['code', 'table']);

function suspects(node, out = []) {
  for (const child of node.children ?? []) {
    if (SUSPECT.has(child.type)) out.push(child);
    suspects(child, out);
  }
  return out;
}

/**
 * The first block the two parsers read differently, or undefined: indented
 * code or a table prettier finds, or a fence the two do not open and close on
 * the same lines, whichever parser opens it. A fence only Pandoc opens is the
 * whole of it, since everything to its close is code to Pandoc.
 *
 * @param {object} ast
 * @param {Block[]} fences The recognizer's fenced code prettier parsed, none
 *   printed as written already.
 * @param {string} text
 * @returns {{start: number, end: number} | undefined}
 */
export function firstUnread(ast, fences, text) {
  const lines = (start, end) => `${lineOf(text, start)}-${lineOf(text, end)}`;
  const recognized = fences;
  const byLines = new Set(recognized.map((b) => lines(b.start, b.end)));
  const nodes = suspects(ast);
  const fencedNodes = new Set(
    nodes
      .filter((n) => n.type === 'code' && !n.isIndented)
      .map((n) => `${n.position.start.line}-${n.position.end.line}`),
  );
  const node = nodes.find(
    (n) =>
      n.type !== 'code' ||
      n.isIndented ||
      !byLines.has(`${n.position.start.line}-${n.position.end.line}`),
  );
  const fence = recognized.find((b) => !fencedNodes.has(lines(b.start, b.end)));
  const misreads = [
    node && {
      start: node.position.start.offset,
      end: node.position.start.offset,
    },
    fence && { start: fence.start, end: fence.end },
  ].filter(Boolean);
  if (misreads.length === 0) return undefined;
  return misreads.reduce((a, b) => (b.start < a.start ? b : a));
}
