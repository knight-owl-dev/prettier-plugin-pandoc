// Both parses as the kinds of block both sides report, in document order.

import { blocks } from '../../src/index.js';
import { readPandoc } from './pandoc.js';

export function pandocKinds(text, tabStop) {
  const kinds = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== 'object') return;
    const kind = {
      BlockQuote: 'block-quote',
      CodeBlock: 'code',
      DefinitionList: 'definition-list',
      Div: 'div',
      LineBlock: 'line-block',
      Table: 'table',
    }[node.t];
    if (kind !== undefined) kinds.push(kind);
    if (node.t === 'RawBlock' && node.c[0] === 'tex') kinds.push('raw-tex');
    // An item per list entry, as the recognizer reports them.
    if (node.t === 'BulletList') {
      for (const item of node.c) {
        kinds.push('list-item');
        walk(item);
      }
      return;
    }
    if (node.t === 'OrderedList') {
      for (const item of node.c[1]) {
        kinds.push('list-item');
        walk(item);
      }
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(readPandoc(text, tabStop)).blocks);
  return kinds;
}

const KIND = {
  'fenced-code': 'code',
  'indented-code': 'code',
  'grid-table': 'table',
  'pipe-table': 'table',
  'simple-table': 'table',
  'multiline-table': 'table',
};
const KINDS = new Set([
  'block-quote',
  'code',
  'definition-list',
  'div',
  'line-block',
  'list-item',
  'raw-tex',
  'table',
]);

export function recognizerKinds(text, tabStop) {
  return blocks(text, { tabStop })
    .map((block) => KIND[block.type] ?? block.type)
    .filter((kind) => KINDS.has(kind));
}
