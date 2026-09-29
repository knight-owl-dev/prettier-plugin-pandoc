// A prettier plugin that formats Pandoc markdown without breaking its blocks.
//
// Prettier's markdown parser is CommonMark, which folds Pandoc's block
// constructs into the paragraph around them. This plugin keeps prettier's own
// parser and printer, and settles only the block boundaries:
//
//   1. @knight-owl-dev/pandoc-blocks finds each block by Pandoc's rules.
//   2. Its markup lines are blanked to spaces in place, so every offset stays
//      true to the source and the stock parser sees the block break Pandoc
//      sees there.
//   3. The nodes a block spans are folded into a node of this plugin's own,
//      which the wrapped printer prints; every other node prints as stock.
//
// Preserve, never repair: markup Pandoc reads as broken stays as written,
// since repairing it would change what the document means.

import { blocks } from '@knight-owl-dev/pandoc-blocks';
import { doc } from 'prettier';
import * as markdown from 'prettier/plugins/markdown';

const { hardline } = doc.builders;
const base = markdown.parsers.markdown;
const mdast = markdown.printers.mdast;

const AST_FORMAT = 'mdast-pandoc';

// Fold the nodes each div spans into a pandocDiv, nesting as the fences do.
function fold(children, divs, text) {
  const end = (div) => (div.close === null ? text.length : div.close.end);
  const inside = (inner, outer) =>
    inner !== outer &&
    inner.open.start > outer.open.start &&
    end(inner) <= end(outer);
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
    while (i < children.length && children[i].position.start.offset < bodyEnd) {
      body.push(children[i++]);
    }
    out.push({
      type: 'pandocDiv',
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
        end: { offset: end(div) },
      },
    });
  }
  while (i < children.length) out.push(children[i++]);
  return out;
}

// Offsets are UTF-16 code units, as the stock parser counts them, so the blanks
// are spliced by slice rather than by spreading the string into code points.
function mask(text, divs) {
  const spans = divs
    .flatMap((div) => [div.open, div.close])
    .filter((span) => span !== null)
    .sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const span of spans) {
    out += text.slice(at, span.start) + ' '.repeat(span.end - span.start);
    at = span.end;
  }
  return out + text.slice(at);
}

async function parse(text, options) {
  const divs = blocks(text).filter((block) => block.type === 'div');
  const ast = await base.parse(mask(text, divs), options);
  ast.children = fold(ast.children, divs, text);
  return ast;
}

function print(path, options, print) {
  const node = path.node;
  if (node.type !== 'pandocDiv') return mdast.print(path, options, print);

  // An unclosed div prints no close: adding one would repair it.
  const close = node.close === null ? [] : [hardline, node.close];
  const body = [];
  path.each((_, index) => {
    body.push(index === 0 ? hardline : [hardline, hardline], print());
  }, 'children');
  return [node.open, ...body, ...close];
}

function getVisitorKeys(node, nonTraversableKeys) {
  return node.type === 'pandocDiv'
    ? ['children']
    : mdast.getVisitorKeys(node, nonTraversableKeys);
}

export const parsers = {
  markdown: { ...base, parse, astFormat: AST_FORMAT },
};

export const printers = {
  [AST_FORMAT]: { ...mdast, print, getVisitorKeys },
};

export default { parsers, printers };
