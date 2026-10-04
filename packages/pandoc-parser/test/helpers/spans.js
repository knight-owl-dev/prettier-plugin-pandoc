// Checks on spans: each node's within its parent's, in order. A table's
// rows are spanned too; a cell's contents are in order within its row, but
// not after another cell's, which in a multiline table share its lines. A
// table's caption may follow its rows, which pandoc-types puts it before.

import assert from 'node:assert/strict';
import { Node, Row } from '../../src/index.js';

// The nodes and rows in `value`, in order, not inside one another.
const collect = (value) => {
  const out = [];
  const visit = (v) => {
    if (v instanceof Node || v instanceof Row) out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
  };
  visit(value);
  return out;
};

// Each node's children, in order.
export const childrenOf = (node) => collect(node.c);

// Every node within `[start, end)`, in order, each within its own.
export function assertNested(nodes, start, end, path) {
  let last = start;
  for (const node of nodes) {
    const at = `${path} > ${node instanceof Row ? 'Row' : node.t}`;
    assert.ok(
      node.start >= last,
      `${at} starts at ${node.start}, before ${last}`,
    );
    assert.ok(node.end >= node.start, `${at} ends before it starts`);
    assert.ok(node.end <= end, `${at} ends at ${node.end}, past ${end}`);
    if (node instanceof Row) {
      for (const cell of node.cells) {
        assertNested(collect(cell), node.start, node.end, `${at} > Cell`);
      }
    } else if (node.t === 'Table') {
      const [, caption, ...parts] = node.c;
      assertNested(collect(caption), node.start, node.end, `${at} > Caption`);
      assertNested(collect(parts), node.start, node.end, at);
    } else {
      assertNested(childrenOf(node), node.start, node.end, at);
    }
    last = node.end;
  }
}
