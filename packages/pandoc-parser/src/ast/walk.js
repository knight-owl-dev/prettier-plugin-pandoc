// Transformations of the AST, bottom up: a node's children before the node.
//
// Ported from pandoc-types 1.23.1.2's `Text.Pandoc.Walk`. One traversal
// takes the instances' transformations as a visitor; nodes keep their spans.

import { Node, Row } from './nodes.js';

/**
 * What a walk applies: to each inline, each block, each list of inlines.
 *
 * @typedef {object} Visitor
 * @property {(x: Node) => Node} [inline]
 * @property {(x: Node) => Node} [block]
 * @property {(xs: Node[]) => Node[]} [inlines]
 */

/**
 * `value`, a block or list of blocks, with `visitor` applied throughout.
 *
 * @see Text.Pandoc.Walk.walk
 * @template T
 * @param {Visitor} visitor
 * @param {T} value
 * @returns {T}
 */
export function walk(visitor, value) {
  const w = walker(visitor);
  return Array.isArray(value) ? w.blocks(value) : w.block(value);
}

/**
 * A list of inlines with `visitor` applied throughout.
 *
 * @see Text.Pandoc.Walk.walk
 * @param {Visitor} visitor
 * @param {Node[]} xs
 * @returns {Node[]}
 */
export const walkInlines = (visitor, xs) => walker(visitor).inlines(xs);

// The traversals of each kind, applying `visitor`.
function walker(visitor) {
  const inlines = (xs) => {
    const ys = xs.map(inline);
    return visitor.inlines ? visitor.inlines(ys) : ys;
  };
  const blocks = (bs) => bs.map(block);
  const caption = ([short, bs]) => [
    short === null ? null : inlines(short),
    blocks(bs),
  ];
  const rows = (rs) =>
    rs.map(
      (r) =>
        new Row(
          r.attr,
          r.cells.map(([a, al, rs_, cs, bs]) => [a, al, rs_, cs, blocks(bs)]),
          r.start,
          r.end,
        ),
    );
  const citation = (c) => ({
    ...c,
    citationPrefix: inlines(c.citationPrefix),
    citationSuffix: inlines(c.citationSuffix),
  });

  // @see Text.Pandoc.Walk.walkInlineM
  function inline(x) {
    const { t, c } = x;
    let d = c;
    switch (t) {
      case 'Emph':
      case 'Underline':
      case 'Strong':
      case 'Strikeout':
      case 'Superscript':
      case 'Subscript':
      case 'SmallCaps':
        d = inlines(c);
        break;
      case 'Quoted':
      case 'Span':
        d = [c[0], inlines(c[1])];
        break;
      case 'Cite':
        d = [c[0].map(citation), inlines(c[1])];
        break;
      case 'Link':
      case 'Image':
        d = [c[0], inlines(c[1]), c[2]];
        break;
      case 'Note':
        d = blocks(c);
        break;
    }
    const y = d === c ? x : new Node(t, d, x.start, x.end);
    return visitor.inline ? visitor.inline(y) : y;
  }

  // @see Text.Pandoc.Walk.walkBlockM
  function block(x) {
    const { t, c } = x;
    let d = c;
    switch (t) {
      case 'Plain':
      case 'Para':
        d = inlines(c);
        break;
      case 'LineBlock':
        d = c.map(inlines);
        break;
      case 'BlockQuote':
        d = blocks(c);
        break;
      case 'OrderedList':
        d = [c[0], c[1].map(blocks)];
        break;
      case 'BulletList':
        d = c.map(blocks);
        break;
      case 'DefinitionList':
        d = c.map(([term, defs]) => [inlines(term), defs.map(blocks)]);
        break;
      case 'Header':
        d = [c[0], c[1], inlines(c[2])];
        break;
      case 'Table': {
        const [attr, capt, specs, head, bodies, foot] = c;
        d = [
          attr,
          caption(capt),
          specs,
          [head[0], rows(head[1])],
          bodies.map(([a, rh, hs, bs]) => [a, rh, rows(hs), rows(bs)]),
          [foot[0], rows(foot[1])],
        ];
        break;
      }
      case 'Figure':
        d = [c[0], caption(c[1]), blocks(c[2])];
        break;
      case 'Div':
        d = [c[0], blocks(c[1])];
        break;
    }
    const y = d === c ? x : new Node(t, d, x.start, x.end);
    return visitor.block ? visitor.block(y) : y;
  }

  return { inlines, blocks, block };
}
