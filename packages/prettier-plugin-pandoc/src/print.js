// Printing: the stock markdown printer, with the nodes it would print wrong
// printed here.

import { DEFAULT_TAB_STOP } from '@knight-owl-dev/pandoc-syntax';
import { doc } from 'prettier';
import * as markdown from 'prettier/plugins/markdown';
import { DIV, isInlineRaw, JOINED, VERBATIM } from './nodes.js';
import { breaksParagraph, keepsBreak } from './wrap.js';

const {
  align,
  hardline,
  label,
  literalline,
  literallineWithoutBreakParent,
  markAsRoot,
} = doc.builders;
const { replaceEndOfLine } = doc.utils;
const mdast = markdown.printers.mdast;

// CommonMark's shortest code fence. A code node reaching this printer is
// fenced code both parsers read alike; unread.js prints the rest as written.
const SHORTEST_FENCE = 3;

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

// A line break as `asWritten` writes one, keeping the spaces before it, which
// in code are content.
const keptLine = markAsRoot(literalline);

// The character a code block's fence was written in. Another could close an
// unclosed fence above it that Pandoc reads as text.
const fenceCharOf = (node, text) =>
  /^[ \t]*(~)/.exec(text.slice(node.position.start.offset))?.[1] ?? '`';

/**
 * Code prints as written, in the fence character it was written in: a
 * sample's two trailing spaces are a hard break it shows. An unclosed fence
 * at the end of the file keeps the file's last newline in its value; stock
 * prettier drops it, and so does this.
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
  const char = fenceCharOf(node, options.originalText);
  const fence = char.repeat(
    Math.max(SHORTEST_FENCE, longestRun(value, char) + 1),
  );
  const info = [node.lang ?? '', node.meta ? ` ${node.meta}` : ''];
  return [fence, ...info, hardline, asWritten(value), keptLine, fence];
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

// A footnote definition: its first paragraph on the marker's line, its body
// indented one tab stop — Pandoc's rule. Stock prettier indents four, which at
// a tab stop of two is code.
function printFootnoteDefinition(path, options, printChild) {
  const tabStop = options.pandocTabStop ?? DEFAULT_TAB_STOP;
  const body = [];
  path.each((_, index) => {
    body.push(index === 0 ? '' : [hardline, hardline], printChild());
  }, 'children');
  return ['[^', path.node.label, ']: ', align(tabStop, body)];
}

const isHardline = (part) =>
  Array.isArray(part) && part[0]?.type === 'line' && part[0].hard === true;

// A list: its items as the stock printer prints them, apart as the source has
// them. Prettier puts a blank line after an item holding one of its own; to
// Pandoc a blank line between items makes the whole list loose.
function printList(path, options, printChild) {
  const parts = mdast.print(path, options, printChild);
  const items = parts.filter((part) => !isHardline(part));
  const { children } = path.node;
  if (items.length !== children.length) {
    throw new Error('prettier printed a list as other than its items');
  }
  const apart = (i) =>
    children[i - 1].position.end.line + 1 < children[i].position.start.line;
  return items.flatMap((item, i) =>
    i === 0 ? [item] : [apart(i) ? [hardline, hardline] : hardline, item],
  );
}

// A block whose last line ends in spaces or tabs. The line after it is its
// parent's.
const TRAILING_SPACE = 'pandocTrailingSpace';
const ENDS_IN_SPACE = /[ \t]$/;

/**
 * `root` with the hard line after each block so labelled kept.
 *
 * @param {unknown} root
 */
function keepTrailingSpace(root) {
  let after = false;
  const walk = (part) => {
    if (typeof part === 'string') {
      if (part !== '') after = false;
      return part;
    }
    if (Array.isArray(part)) return part.map(walk);
    if (part.type === 'line' && part.hard) {
      const keep = after && !part.literal;
      after = false;
      return keep ? markAsRoot(literallineWithoutBreakParent) : part;
    }
    if (part.type === 'if-break') {
      return {
        ...part,
        breakContents: walk(part.breakContents),
        flatContents: walk(part.flatContents),
      };
    }
    if (part.type === 'fill') return { ...part, parts: walk(part.parts) };
    if (part.contents === undefined) return part;
    const walked = { ...part, contents: walk(part.contents) };
    if (part.type === 'label' && part.label === TRAILING_SPACE) after = true;
    return walked;
  };
  return walk(root);
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
 * A node prettier-ignore holds, as its source: labelled as a printed verbatim
 * block is.
 *
 * @param {object} path
 * @param {object} options
 */
export function printPrettierIgnored(path, options) {
  const source = mdast.printPrettierIgnored(path, options);
  return typeof source === 'string' && ENDS_IN_SPACE.test(source)
    ? label(TRAILING_SPACE, source)
    : source;
}

/**
 * @param {object} path
 * @param {object} options
 * @param {Function} printChild Prints the node at the path's current child.
 */
export function print(path, options, printChild) {
  const node = path.node;
  if (isInlineRaw(node)) return replaceEndOfLine(node.value);
  switch (node.type) {
    case DIV:
      return printDiv(path, printChild);
    case VERBATIM:
      return ENDS_IN_SPACE.test(node.value)
        ? label(TRAILING_SPACE, asWritten(node.value))
        : asWritten(node.value);
    case JOINED: {
      const [above, below] = path.map(printChild, 'children');
      return [above, asWritten(node.hardBreak ? '  \n' : '\n'), below];
    }
    case 'code':
      return printCode(node, options);
    case 'whitespace':
      if (keepsBreak(path)) return asWritten('\n');
      return breaksParagraph(path, options)
        ? mdast.print(path, { ...options, proseWrap: 'never' }, printChild)
        : mdast.print(path, options, printChild);
    case 'list':
      return printList(path, options, printChild);
    case 'footnoteDefinition':
      return printFootnoteDefinition(path, options, printChild);
    case 'emphasis':
      return (
        printTripleRun(path, options, printChild) ??
        mdast.print(path, options, printChild)
      );
    case 'root':
      return keepTrailingSpace(mdast.print(path, options, printChild));
    default:
      return mdast.print(path, options, printChild);
  }
}
