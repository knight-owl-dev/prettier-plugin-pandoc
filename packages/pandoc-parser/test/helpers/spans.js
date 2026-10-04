// Checks on spans: each node's within its parent's, in order. A table's
// rows are spanned too; a cell's contents are in order within its row, but
// not after another cell's, which in a multiline table share its lines;
// a cell spanning rows within the table, past its own row. A
// caption is checked apart from what it captions: a table's may follow its
// rows, and an implicit figure's is its image's description. A note's
// contents span its definition, wherever that is; so does a block quote's
// citation (csquotes'), read before the quote and placed after it.

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
        // A cell spanning rows runs on past its own row, within the table.
        const cellEnd = cell[2] > 1 ? end : node.end;
        assertNested(collect(cell), node.start, cellEnd, `${at} > Cell`);
      }
    } else if (node.t === 'Note') {
      assertNested(childrenOf(node), 0, Number.POSITIVE_INFINITY, at);
    } else if (node.t === 'BlockQuote' || node.t === 'Div') {
      const children = childrenOf(node);
      const [before, last] = [children.at(-2), children.at(-1)];
      const moved = last?.t === 'Para' && before && last.start < before.end;
      const body = moved ? children.slice(0, -1) : children;
      assertNested(body, node.start, node.end, at);
      if (moved) assertNested([last], node.start, node.end, `${at} > Citation`);
    } else if (node.t === 'Table' || node.t === 'Figure') {
      const [, caption, ...parts] = node.c;
      assertNested(collect(caption), node.start, node.end, `${at} > Caption`);
      assertNested(collect(parts), node.start, node.end, at);
    } else {
      assertNested(childrenOf(node), node.start, node.end, at);
    }
    last = node.end;
  }
}
