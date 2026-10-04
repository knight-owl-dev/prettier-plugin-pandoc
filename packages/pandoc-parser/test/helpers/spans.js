// Checks on spans: each node's within its parent's, in order.

import assert from 'node:assert/strict';
import { Node } from '../../src/index.js';

// Each node's children, in order.
export const childrenOf = (node) => {
  const out = [];
  const visit = (v) => {
    if (v instanceof Node) out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
  };
  visit(node.c);
  return out;
};

// Every node within `[start, end)`, in order, each within its own.
export function assertNested(nodes, start, end, path) {
  let last = start;
  for (const node of nodes) {
    const at = `${path} > ${node.t}`;
    assert.ok(
      node.start >= last,
      `${at} starts at ${node.start}, before ${last}`,
    );
    assert.ok(node.end >= node.start, `${at} ends before it starts`);
    assert.ok(node.end <= end, `${at} ends at ${node.end}, past ${end}`);
    assertNested(childrenOf(node), node.start, node.end, at);
    last = node.end;
  }
}
