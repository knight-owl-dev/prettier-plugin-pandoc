// A prettier plugin that formats Pandoc markdown without breaking its blocks.
//
// Prettier's markdown parser is CommonMark, which folds Pandoc's block
// constructs into the paragraph around them. This plugin keeps prettier's own
// parser and printer, and settles only the block boundaries:
//
//   1. @knight-owl-dev/pandoc-syntax finds each block by Pandoc's rules.
//   2. Each block is masked in place, so every offset stays true to the source
//      and the stock parser sees the block break Pandoc sees there. A div's
//      fence lines blank to spaces. A verbatim block's lines — raw TeX, verse,
//      Pandoc tables — each become `#` and spaces: an ATX heading ends on its
//      own line and interrupts a paragraph, as raw TeX does, and text after a
//      mid-line end stays out of an indented code block, where blanking would
//      put it.
//   3. The nodes a block spans are replaced by a node of this plugin's own,
//      which the wrapped printer prints; every other node prints as stock.
//
// Preserve, never repair: markup Pandoc reads as broken stays as written,
// since repairing it would change what the document means.

import { blocks } from '@knight-owl-dev/pandoc-syntax';
import { doc } from 'prettier';
import * as markdown from 'prettier/plugins/markdown';

const { align, hardline, literalline, markAsRoot } = doc.builders;
const { replaceEndOfLine } = doc.utils;
const base = markdown.parsers.markdown;
const mdast = markdown.printers.mdast;

const AST_FORMAT = 'mdast-pandoc';

// Printed as written: raw TeX is another language's source, verse is its line
// breaks, and a Pandoc table's layout is its column alignment. Definition,
// example and fancy lists are CommonMark paragraphs to prettier's parser, so
// their content stays unformatted until the plugin formats inside them.
const VERBATIM = new Set([
  'raw-tex',
  'line-block',
  'grid-table',
  'simple-table',
  'multiline-table',
  'definition-list',
  'example-list',
  'fancy-list',
]);

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

const lineEnd = (text, at) => {
  const newline = text.indexOf('\n', at);
  return newline === -1 ? text.length : newline;
};

// Offsets are UTF-16 code units, as the stock parser counts them, so the mask
// is spliced by slice rather than by spreading the string into code points.
function mask(text, divs, verbatimBlocks) {
  const edits = [
    ...divs
      .flatMap((div) => [div.open, div.close])
      .filter((span) => span !== null)
      .map((span) => ({ ...span, fill: (length) => ' '.repeat(length) })),
    ...verbatimBlocks.flatMap((raw) => {
      const lines = [];
      for (let at = raw.start; at < raw.end; at = lineEnd(text, at) + 1) {
        const end = Math.min(lineEnd(text, at), raw.end);
        if (end > at) {
          lines.push({ start: at, end, fill: (n) => `#${' '.repeat(n - 1)}` });
        }
      }
      return lines;
    }),
  ].sort((a, b) => a.start - b.start);

  let out = '';
  let at = 0;
  for (const edit of edits) {
    out += text.slice(at, edit.start) + edit.fill(edit.end - edit.start);
    at = edit.end;
  }
  return out + text.slice(at);
}

// Replace the headings each verbatim mask produced with the source they stand
// for. A mid-line end leaves text the heading swallowed; it is kept as written,
// the whole line with it.
function restoreVerbatim(children, verbatimBlocks, text) {
  const out = [];
  let i = 0;
  for (const raw of verbatimBlocks) {
    const end = lineEnd(text, raw.end);
    while (
      i < children.length &&
      children[i].position.start.offset < raw.start
    ) {
      out.push(children[i++]);
    }
    while (i < children.length && children[i].position.start.offset < end) {
      i++;
    }
    out.push({
      type: 'pandocVerbatim',
      value: text.slice(raw.start, end),
      position: { start: { offset: raw.start }, end: { offset: end } },
    });
  }
  while (i < children.length) out.push(children[i++]);
  return out;
}

async function parse(text, options) {
  const found = blocks(text);
  const divs = found.filter((block) => block.type === 'div');
  const verbatimBlocks = found.filter((block) => VERBATIM.has(block.type));
  const ast = await base.parse(mask(text, divs, verbatimBlocks), options);
  ast.children = fold(
    restoreVerbatim(ast.children, verbatimBlocks, text),
    divs,
    text,
  );
  return ast;
}

// The longest run of `char` in `text`, for a fence that cannot close early.
const longestRun = (text, char) =>
  Math.max(
    0,
    ...[...text.matchAll(new RegExp(`\\${char}+`, 'g'))].map(
      (m) => m[0].length,
    ),
  );

// Code prints as written. Stock prettier breaks its lines with hardline, which
// trims trailing whitespace — and a sample's two trailing spaces are a hard
// break it shows. A literal line does not trim; marked as root, it keeps the
// indentation the block sits at, inside a list item say.
function printCode(node, options) {
  let { value } = node;
  // An unclosed fence at the end of the file keeps the file's last newline
  // in its value; stock prettier drops it, and so does this.
  if (
    node.position.end.offset === options.originalText.length &&
    value.endsWith('\n') &&
    options.originalText.endsWith('\n')
  ) {
    value = value.slice(0, -1);
  }
  const body = markAsRoot(replaceEndOfLine(value, literalline));
  if (node.isIndented) return align(4, ['    ', body]);
  const fence = '`'.repeat(Math.max(3, longestRun(value, '`') + 1));
  const info = [node.lang ?? '', node.meta ? ` ${node.meta}` : ''];
  return [fence, ...info, hardline, body, hardline, fence];
}

// `***x***` is strong around emphasis to Pandoc and emphasis around strong to
// prettier's parser, which prints it as `_**x**_` — emphasis around strong to
// Pandoc too. Where the source wrote the triple run, it is written again.
function printTripleRun(path, options, print) {
  const node = path.node;
  if (node.children.length !== 1 || node.children[0].type !== 'strong') {
    return null;
  }
  const source = options.originalText.slice(
    node.position.start.offset,
    node.position.end.offset,
  );
  const run = /^(\*\*\*|___)/.exec(source)?.[1];
  if (run === undefined) return null;
  return [
    run,
    path.call((inner) => inner.map(print, 'children'), 'children', 0),
    run,
  ];
}

function print(path, options, print) {
  const node = path.node;
  if (node.type === 'code') return printCode(node, options);
  if (node.type === 'emphasis') {
    const triple = printTripleRun(path, options, print);
    if (triple !== null) return triple;
  }
  if (node.type === 'pandocVerbatim') return replaceEndOfLine(node.value);
  if (node.type !== 'pandocDiv') return mdast.print(path, options, print);

  // An unclosed div prints no close: adding one would repair it.
  const close = node.close === null ? [] : [hardline, node.close];
  const body = [];
  path.each((_, index) => {
    body.push(index === 0 ? hardline : [hardline, hardline], print());
  }, 'children');
  return [node.open, ...body, ...close];
}

// The embed pass walks the tree, so each node of this plugin's own names its
// children: a div has some, a verbatim block is a leaf.
const VISITOR_KEYS = { pandocDiv: ['children'], pandocVerbatim: [] };

function getVisitorKeys(node, nonTraversableKeys) {
  return (
    VISITOR_KEYS[node.type] ?? mdast.getVisitorKeys(node, nonTraversableKeys)
  );
}

export const parsers = {
  markdown: { ...base, parse, astFormat: AST_FORMAT },
};

export const printers = {
  [AST_FORMAT]: { ...mdast, print, getVisitorKeys },
};

export default { parsers, printers };
