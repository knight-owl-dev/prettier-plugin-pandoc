// Settling: after the masked parse, each masked construct becomes a node of
// this plugin's own, in the node of prettier's tree that holds it.

import { containerNodes } from './containers.js';
import { DIV, INLINE_RAW, VERBATIM } from './nodes.js';
import { lineEnd } from './text.js';

/** @typedef {import('@knight-owl-dev/pandoc-syntax').Block} Block */
/** @typedef {{start: number, end: number}} Span */

const startOf = (block) =>
  block.type === 'div' ? block.open.start : block.start;
const offsetOf = (node) => node.position.start.offset;

// Where a div ends: its closing fence, or the end of the document.
const divEnd = (div, text) =>
  div.close === null ? text.length : div.close.end;

/**
 * Fold the nodes each div spans into a div node, nesting as the fences do.
 *
 * @param {object[]} children
 * @param {Block[]} divs
 * @param {string} text
 * @returns {object[]}
 */
function fold(children, divs, text) {
  const inside = (inner, outer) =>
    inner !== outer &&
    inner.open.start > outer.open.start &&
    divEnd(inner, text) <= divEnd(outer, text);
  const outermost = divs.filter((div) => !divs.some((o) => inside(div, o)));

  const out = [];
  let i = 0;
  for (const div of outermost) {
    const bodyEnd = div.close === null ? text.length : div.close.start;
    while (
      i < children.length &&
      children[i].position.end.offset <= div.open.start
    ) {
      out.push(children[i++]);
    }
    const body = [];
    while (i < children.length && offsetOf(children[i]) < bodyEnd) {
      body.push(children[i++]);
    }
    out.push({
      type: DIV,
      open: text.slice(div.open.start, div.open.end).trimEnd(),
      close:
        div.close === null
          ? null
          : text.slice(div.close.start, div.close.end).trimEnd(),
      children: fold(
        body,
        divs.filter((d) => inside(d, div)),
        text,
      ),
      position: {
        start: { offset: div.open.start },
        end: { offset: divEnd(div, text) },
      },
    });
  }
  while (i < children.length) out.push(children[i++]);
  return out;
}

/**
 * Replace the headings each verbatim mask produced with the source they stand
 * for: the segments' text, a container's prefixes left out for its printer to
 * write again. A mid-line end leaves text the heading swallowed; it is kept as
 * written, the rest of the line with it.
 *
 * @param {object[]} children
 * @param {Block[]} verbatim
 * @param {string} text
 * @returns {object[]}
 */
function restoreVerbatim(children, verbatim, text) {
  const out = [];
  let i = 0;
  for (const block of verbatim) {
    const end = lineEnd(text, block.end);
    while (i < children.length && offsetOf(children[i]) < block.start) {
      out.push(children[i++]);
    }
    while (i < children.length && offsetOf(children[i]) < end) i++;
    const lines = block.segments.map((s) => text.slice(s.start, s.end));
    out.push({
      type: VERBATIM,
      value: lines.join('\n') + text.slice(block.end, end),
      position: { start: { offset: block.start }, end: { offset: end } },
    });
  }
  while (i < children.length) out.push(children[i++]);
  return out;
}

/**
 * Turn each code span an inline raw TeX mask produced back into its source.
 *
 * @param {object} node
 * @param {Map<number, Span>} spans Masked spans by start offset.
 * @param {string} text
 */
function restoreInline(node, spans, text) {
  if (node.type === 'inlineCode' && spans.has(offsetOf(node))) {
    const { start, end } = spans.get(offsetOf(node));
    return {
      type: 'inlineCode',
      [INLINE_RAW]: true,
      value: text.slice(start, end),
      position: node.position,
    };
  }
  if (node.children !== undefined) {
    node.children = node.children.map((child) =>
      restoreInline(child, spans, text),
    );
  }
  return node;
}

/**
 * The node each block settles in: the innermost container around it, or the
 * root. Container nodes come in document order, a parent before its children,
 * so the last one holding a block is the innermost.
 *
 * @param {object} ast
 * @param {Block[]} found
 * @returns {Map<object, Block[]>}
 */
function holders(ast, found) {
  const nodes = containerNodes(ast);
  const byNode = new Map([ast, ...nodes].map((node) => [node, []]));
  for (const block of found) {
    const at = startOf(block);
    const holder = nodes.findLast(
      (n) => offsetOf(n) <= at && at < n.position.end.offset,
    );
    byNode.get(holder ?? ast).push(block);
  }
  return byNode;
}

/**
 * Settle every masked construct in the tree the masked source parsed to.
 *
 * @param {object} ast
 * @param {{divs: Block[], verbatim: Block[], inlineRaw: Span[]}} constructs
 * @param {string} text
 */
export function settle(ast, { divs, verbatim, inlineRaw }, text) {
  restoreInline(ast, new Map(inlineRaw.map((s) => [s.start, s])), text);
  for (const [node, held] of holders(ast, [...divs, ...verbatim])) {
    node.children = fold(
      restoreVerbatim(
        node.children,
        held.filter((b) => b.type !== 'div'),
        text,
      ),
      held.filter((b) => b.type === 'div'),
      text,
    );
  }
}
