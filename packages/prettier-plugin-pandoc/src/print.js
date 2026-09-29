// Printing: the stock markdown printer, with the nodes it would print wrong
// printed here.

import { doc } from 'prettier';
import * as markdown from 'prettier/plugins/markdown';
import { DIV, INLINE_RAW, VERBATIM } from './nodes.js';

const { align, hardline, literalline, markAsRoot } = doc.builders;
const { replaceEndOfLine } = doc.utils;
const mdast = markdown.printers.mdast;

// CommonMark's shortest code fence, and the indentation that makes code.
const SHORTEST_FENCE = 3;
const CODE_INDENT = '    ';

// The longest run of `char` in `text`, for a fence that cannot close early.
const longestRun = (text, char) =>
  Math.max(
    0,
    ...[...text.matchAll(new RegExp(`\\${char}+`, 'g'))].map(
      (m) => m[0].length,
    ),
  );

// Lines printed as written. A literal line does not trim trailing whitespace,
// as the stock hardline does; marked as root, it keeps the indentation the
// block sits at — a quote's `>`, a list item's indentation.
const asWritten = (value) => markAsRoot(replaceEndOfLine(value, literalline));

/**
 * Code prints as written: a sample's two trailing spaces are a hard break it
 * shows. An unclosed fence at the end of the file keeps the file's last
 * newline in its value; stock prettier drops it, and so does this.
 *
 * @param {object} node
 * @param {object} options
 */
function printCode(node, options) {
  let { value } = node;
  const atEnd = node.position.end.offset === options.originalText.length;
  if (atEnd && value.endsWith('\n') && options.originalText.endsWith('\n')) {
    value = value.slice(0, -1);
  }
  if (node.isIndented) {
    return align(CODE_INDENT.length, [CODE_INDENT, asWritten(value)]);
  }
  const fence = '`'.repeat(
    Math.max(SHORTEST_FENCE, longestRun(value, '`') + 1),
  );
  const info = [node.lang ?? '', node.meta ? ` ${node.meta}` : ''];
  return [fence, ...info, hardline, asWritten(value), hardline, fence];
}

// `***x***` is strong around emphasis to Pandoc and emphasis around strong to
// prettier's parser, which prints it as `_**x**_` — emphasis around strong to
// Pandoc too. Where the source wrote the triple run, it is written again.
const TRIPLE_RUN = /^(\*\*\*|___)/;

/**
 * @returns {unknown[] | null} The triple run, or null for emphasis it does
 *   not hold.
 */
function printTripleRun(path, options, printChild) {
  const node = path.node;
  if (node.children.length !== 1 || node.children[0].type !== 'strong') {
    return null;
  }
  const source = options.originalText.slice(
    node.position.start.offset,
    node.position.end.offset,
  );
  const run = TRIPLE_RUN.exec(source)?.[1];
  if (run === undefined) return null;
  const inner = path.call(
    (strong) => strong.map(printChild, 'children'),
    'children',
    0,
  );
  return [run, inner, run];
}

// A div: its fences as written, its body formatted. An unclosed div prints no
// close, since adding one would repair it.
function printDiv(path, printChild) {
  const node = path.node;
  const body = [];
  path.each((_, index) => {
    body.push(index === 0 ? hardline : [hardline, hardline], printChild());
  }, 'children');
  const close = node.close === null ? [] : [hardline, node.close];
  return [node.open, ...body, ...close];
}

/**
 * @param {object} path
 * @param {object} options
 * @param {Function} printChild Prints the node at the path's current child.
 */
export function print(path, options, printChild) {
  const node = path.node;
  switch (node.type) {
    case DIV:
      return printDiv(path, printChild);
    case VERBATIM:
      return asWritten(node.value);
    case INLINE_RAW:
      return replaceEndOfLine(node.value);
    case 'code':
      return printCode(node, options);
    case 'emphasis':
      return (
        printTripleRun(path, options, printChild) ??
        mdast.print(path, options, printChild)
      );
    default:
      return mdast.print(path, options, printChild);
  }
}
