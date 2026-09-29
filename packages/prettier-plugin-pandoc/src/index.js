// A prettier plugin that formats Pandoc markdown without breaking its syntax.
//
// Prettier's markdown parser is CommonMark, which folds Pandoc's block
// constructs into the paragraph around them and reads markdown inside its raw
// TeX. This plugin keeps prettier's own parser and printer, and settles only
// where Pandoc's constructs are:
//
//   1. @knight-owl-dev/pandoc-syntax finds each one by Pandoc's rules.
//   2. Each is masked in place, so every offset stays true to the source and
//      the stock parser sees what Pandoc sees there. A div's fence lines blank
//      to spaces. A verbatim block's lines — raw TeX, verse, Pandoc tables —
//      each become `#` and spaces: an ATX heading ends on its own line and
//      interrupts a paragraph, as raw TeX does, and text after a mid-line end
//      stays out of an indented code block, where blanking would put it.
//      Inline raw TeX becomes a code span, which prettier neither wraps nor
//      reads markdown inside.
//   3. The nodes a construct spans are replaced by a node of this plugin's
//      own, which the wrapped printer prints; every other node prints as
//      stock.
//
// Preserve, never repair: markup Pandoc reads as broken stays as written,
// since repairing it would change what the document means.

import { blocks, inlines } from '@knight-owl-dev/pandoc-syntax';
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
// A code span needs a backtick at each end, and one beside it would lengthen
// the run the span opens or closes on. Such a span is left unmasked; nothing
// shorter than three characters holds a space to wrap at.
const maskable = (text, span) =>
  span.end - span.start >= 3 &&
  text[span.start - 1] !== '`' &&
  text[span.end] !== '`';

function mask(text, divs, verbatimBlocks, inlineRaw) {
  const edits = [
    ...divs
      .flatMap((div) => [div.open, div.close])
      .filter((span) => span !== null)
      .map((span) => ({ ...span, fill: (length) => ' '.repeat(length) })),
    // Line by line, by the recognizer's segments: inside a container those
    // stop short of its prefix, which stays for the stock parser to read.
    ...verbatimBlocks.flatMap((block) =>
      block.segments
        .filter((segment) => segment.end > segment.start)
        .map((segment) => ({
          ...segment,
          fill: (n) => `#${' '.repeat(n - 1)}`,
        })),
    ),
    ...inlineRaw.map((span) => ({
      ...span,
      fill: (n) => `\`${'x'.repeat(n - 2)}\``,
    })),
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
// for: the segments' text, a container's prefixes left out for its printer to
// write again. A mid-line end leaves text the heading swallowed; it is kept as
// written, the rest of the line with it.
function restoreVerbatim(children, verbatimBlocks, text) {
  const out = [];
  let i = 0;
  for (const block of verbatimBlocks) {
    const end = lineEnd(text, block.end);
    while (
      i < children.length &&
      children[i].position.start.offset < block.start
    ) {
      out.push(children[i++]);
    }
    while (i < children.length && children[i].position.start.offset < end) {
      i++;
    }
    const lines = block.segments.map((s) => text.slice(s.start, s.end));
    out.push({
      type: 'pandocVerbatim',
      value: lines.join('\n') + text.slice(block.end, end),
      position: { start: { offset: block.start }, end: { offset: end } },
    });
  }
  while (i < children.length) out.push(children[i++]);
  return out;
}

// Turn each code span an inline raw TeX mask produced back into its source.
function restoreInline(node, starts, text) {
  if (node.type === 'inlineCode' && starts.has(node.position.start.offset)) {
    const { start, end } = starts.get(node.position.start.offset);
    return {
      type: 'pandocInlineRaw',
      value: text.slice(start, end),
      position: node.position,
    };
  }
  if (node.children !== undefined) {
    node.children = node.children.map((child) =>
      restoreInline(child, starts, text),
    );
  }
  return node;
}

const CONTAINER_NODE = { 'block-quote': 'blockquote', 'list-item': 'listItem' };
const isContainer = (block) => CONTAINER_NODE[block.type] !== undefined;
const within = (inner, outer) =>
  inner !== outer && inner.start >= outer.start && inner.end <= outer.end;
const startOf = (block) =>
  block.type === 'div' ? block.open.start : block.start;

// Every node of prettier's tree that holds blocks of its own, by type.
function containerNodes(node, out = []) {
  if (node.type === 'blockquote' || node.type === 'listItem') out.push(node);
  for (const child of node.children ?? []) containerNodes(child, out);
  return out;
}

// The first container prettier's parser bounds where Pandoc does not, or
// undefined. CommonMark continues a container lazily only into paragraph
// text; Pandoc collects its text first, so after a heading or a fence the two
// part. Each is found by where its marker sits. Their ends agree when all that
// lies between them is what the masks blanked, a quote's bare `>` included.
function firstMisread(containers, ast, text, masked) {
  const nodes = containerNodes(ast);
  return containers.find((container) => {
    const marker =
      container.start + /^[ \t]*/.exec(text.slice(container.start))[0].length;
    const node = nodes.find(
      (n) =>
        n.type === CONTAINER_NODE[container.type] &&
        n.position.start.offset === marker,
    );
    if (node === undefined) return true;
    const end = node.position.end.offset;
    return (
      end > container.end || !/^[\s>]*$/.test(masked.slice(end, container.end))
    );
  });
}

// The top-level stretch of the document a misread container sits in: its
// outermost container, and for a list item the whole list, as far as items
// follow one another. It prints as written, since no smaller piece of it
// reads the same to both parsers.
function stretchOf(container, containers, text) {
  const outermost = containers.find(
    (c) =>
      !containers.some((o) => within(c, o)) &&
      (c === container || within(container, c)),
  );
  const top = containers.filter((c) => !containers.some((o) => within(c, o)));
  let { start, end } = outermost;
  if (outermost.type === 'list-item') {
    const i = top.indexOf(outermost);
    const gap = (a, b) => /^\s*$/.test(text.slice(a.end, b.start));
    for (
      let k = i;
      k > 0 && top[k - 1].type === 'list-item' && gap(top[k - 1], top[k]);
      k--
    ) {
      start = top[k - 1].start;
    }
    for (
      let k = i;
      k + 1 < top.length &&
      top[k + 1].type === 'list-item' &&
      gap(top[k], top[k + 1]);
      k++
    ) {
      end = top[k + 1].end;
    }
  }
  const segments = [];
  for (let at = start; at <= end; at = lineEnd(text, at) + 1) {
    segments.push({ start: at, end: Math.min(lineEnd(text, at), end) });
  }
  return { type: 'verbatim', start, end, segments };
}

// Settle each construct in the node of prettier's tree that holds it: the
// innermost container around it, or the root.
function settle(ast, divs, verbatimBlocks, text) {
  const nodes = containerNodes(ast);
  const holder = (offset) =>
    nodes
      .filter(
        (n) =>
          n.position.start.offset <= offset && offset < n.position.end.offset,
      )
      .reduce(
        (inner, n) =>
          inner === ast ||
          n.position.start.offset >= inner.position.start.offset
            ? n
            : inner,
        ast,
      );
  for (const node of [ast, ...nodes]) {
    const held = (block) => holder(startOf(block)) === node;
    node.children = fold(
      restoreVerbatim(node.children, verbatimBlocks.filter(held), text),
      divs.filter(held),
      text,
    );
  }
}

async function parse(text, options) {
  const found = blocks(text);
  let containers = found.filter(isContainer);
  let verbatimBlocks = found.filter((block) => VERBATIM.has(block.type));
  let divs = found.filter((block) => block.type === 'div');
  let inlineRaw = inlines(text, found).filter((span) => maskable(text, span));

  // One misread shifts every container after it, so each is settled before
  // the next is judged: the earliest printed as written, the rest parsed again.
  let masked = mask(text, divs, verbatimBlocks, inlineRaw);
  let ast = await base.parse(masked, options);
  for (
    let wrong = firstMisread(containers, ast, text, masked);
    wrong !== undefined;
    wrong = firstMisread(containers, ast, text, masked)
  ) {
    const stretch = stretchOf(wrong, containers, text);
    // What the stretch holds is its to print; masks inside it would overlap.
    const outside = (block) =>
      startOf(block) < stretch.start || startOf(block) > stretch.end;
    verbatimBlocks = [...verbatimBlocks.filter(outside), stretch].sort(
      (a, b) => a.start - b.start,
    );
    divs = divs.filter(outside);
    inlineRaw = inlineRaw.filter(outside);
    containers = containers.filter(outside);
    masked = mask(text, divs, verbatimBlocks, inlineRaw);
    ast = await base.parse(masked, options);
  }

  restoreInline(
    ast,
    new Map(inlineRaw.map((span) => [span.start, span])),
    text,
  );
  settle(ast, divs, verbatimBlocks, text);
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
  // Marked as root, a verbatim block's lines keep the container they sit in:
  // a quote's `>`, a list item's indentation.
  if (node.type === 'pandocVerbatim') {
    return markAsRoot(replaceEndOfLine(node.value, literalline));
  }
  if (node.type === 'pandocInlineRaw') return replaceEndOfLine(node.value);
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
const VISITOR_KEYS = {
  pandocDiv: ['children'],
  pandocVerbatim: [],
  pandocInlineRaw: [],
};

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
