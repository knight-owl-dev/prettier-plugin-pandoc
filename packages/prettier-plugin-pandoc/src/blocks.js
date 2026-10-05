// Blocks printed in a view of the text: a container from the contents the
// parser read, its prefixes rebuilt; a paragraph reflowed (wrap.js); any
// other block as written. A list item's marker and a fence print as
// written too.

import { readMarkdown } from '@knight-owl-dev/pandoc-parser';
import { printCode } from './code.js';
import { reflow } from './wrap.js';

/** @typedef {import('./wrap.js').View} View */
/** @typedef {import('./wrap.js').Context} Context */

/**
 * The source as a view of itself.
 *
 * @param {string} text
 * @returns {View}
 */
export const sourceView = (text) => ({
  text,
  start: (offset) => offset,
  end: (offset) => offset,
});

// A container's contents as the parser read them.
const contentsView = (contents) => ({
  text: contents.text,
  start: (offset) => contents.toInnerStart(offset),
  end: (offset) => contents.toInnerEnd(offset),
});

// Where the line `offset` is on starts.
export const lineStart = (text, offset) =>
  text.lastIndexOf('\n', offset - 1) + 1;

/**
 * Where a block runs in `view`. A block that reads to the end of its lines,
 * a raw one's, spans the newline after them: it spaces as the gap's.
 *
 * @param {{start: number, end: number}} block
 * @param {View} view
 * @returns {[number, number]}
 */
export function extent(block, view) {
  const start = view.start(block.start);
  let end = view.end(block.end);
  while (end > start && view.text[end - 1] === '\n') end--;
  return [start, end];
}

const hasBlankLine = (text) => /\n[ \t]*\n/.test(text);

/**
 * Text between blocks in a container: runs of blank lines made one, none
 * added, since a blank line makes a list loose; none at either end of the
 * content.
 *
 * @param {string} gap
 * @param {boolean} first
 * @param {boolean} last
 */
function collapsed(gap, first, last) {
  let out = gap.replace(/\n(?:[ \t]*\n)+/g, '\n\n');
  if (first) out = out.replace(/^(?:[ \t]*\n)+/, '');
  if (last) out = out.replace(/\s+$/, '');
  return out;
}

/**
 * Blocks printed with the text between them, from `from` to `to` in `view`.
 * Null where one of them reads past the next.
 *
 * @param {object[]} blocks
 * @param {View} view
 * @param {number} from
 * @param {number} to
 * @param {Context} context
 * @param {object} options
 * @returns {string | null}
 */
function printIn(blocks, view, from, to, context, options) {
  let out = '';
  let at = from;
  for (const [k, block] of blocks.entries()) {
    const [start, end] = extent(block, view);
    if (start < at) return null;
    out += collapsed(view.text.slice(at, start), k === 0, false);
    // On the first line, past the context's column; on others, from 0.
    const column = out.includes('\n')
      ? columnAfter(out)
      : context.column + out.length;
    const here = { ...context, column };
    out += printBlock(block, view, here, options);
    at = end;
  }
  if (at > to) return null;
  return out + collapsed(view.text.slice(at, to), blocks.length === 0, true);
}

/**
 * `body`'s lines, the first after `first` and each other after `rest`; a
 * blank one after either with its spaces left out.
 *
 * @param {string} body
 * @param {string} first
 * @param {string} rest
 */
function prefixed(body, first, rest) {
  return body
    .split('\n')
    .map((line, k) => {
      const prefix = k === 0 ? first : rest;
      return line === '' ? prefix.trimEnd() : prefix + line;
    })
    .join('\n');
}

// A string's tabs as the spaces they reach from column 0.
function expandTabs(text, tabStop) {
  let out = '';
  for (const c of text) {
    out += c === '\t' ? ' '.repeat(tabStop - (out.length % tabStop)) : c;
  }
  return out;
}

/**
 * What a list item's or definition's contents follow on their first line,
 * from where that line starts in `view`: the marker as written. Null where
 * that is no marker.
 *
 * @param {import('@knight-owl-dev/pandoc-parser').SourceText} contents
 * @param {View} view
 * @param {number} tabStop
 * @returns {{marker: string, line: number, at: number} | null}
 */
function markerOf(contents, view, tabStop) {
  const first = contents.pieces[0];
  if (first === undefined) return null;
  const at = view.start(first.from);
  const line = lineStart(view.text, at);
  const marker = view.text.slice(line, at);
  const expanded = expandTabs(marker, tabStop);
  return /^ *\S+ *$/.test(expanded) ? { marker, line, at } : null;
}

/**
 * The columns Pandoc strips from an item's or definition's lines after
 * `marker` alone on its line; null where it opens none.
 *
 * @param {string} marker
 * @param {boolean} definition
 * @param {number} tabStop
 * @returns {number | null}
 */
function indentAfter(marker, definition, tabStop) {
  const lines = `${marker}\n${' '.repeat(marker.length)}x\n`;
  const text = definition ? `Term\n${lines}` : lines;
  const [block] = readMarkdown(text, { tabStop }).blocks;
  const items = {
    BulletList: () => block.c,
    OrderedList: () => block.c[1],
    DefinitionList: () => (definition ? block.c[0][1] : undefined),
  }[block?.t]?.();
  return items?.[0]?.indent ?? null;
}

/**
 * Items, each its marker and its contents printed, a blank line between
 * two where there was one: the marker's line as written, each other line
 * indented as far as Pandoc strips. Null where one prints as written.
 *
 * @param {object[][]} items
 * @param {View} view
 * @param {number} after Where the text before the first item ends.
 * @param {boolean} definitions Whether they are a term's definitions, the
 *   first on the line after it.
 * @param {Context} context
 * @param {object} options
 * @returns {{text: string, end: number} | null}
 */
function printItems(items, view, after, definitions, context, options) {
  const tabStop = options.pandocTabStop;
  let out = '';
  // A list's first marker is on the line the caller printed up to `after`.
  let end = definitions ? after : lineStart(view.text, after);
  for (const item of items) {
    const { contents, indent } = item;
    if (contents === undefined || indent === undefined || item.length === 0) {
      return null;
    }
    const found = markerOf(contents, view, tabStop);
    if (found === null || found.line < end) return null;
    const { marker, line, at } = found;
    // A list's first marker from where its block starts: Pandoc counts the
    // item's indent from there.
    const opening = out === '' && !definitions;
    const first = opening ? view.text.slice(Math.max(line, after), at) : marker;
    const inner = contentsView(contents);
    // Spaces Pandoc left before the first line's text, five past the marker
    // or part of a tab, print as written.
    if (/^[ \t]+\S/.test(inner.text)) return null;
    // Contents starting on the line after the marker stay there, below the
    // marker alone, as far in as Pandoc strips after it.
    const alone = /^[ \t]*\n/.test(inner.text)
      ? indentAfter(expandTabs(first, tabStop).trimEnd(), definitions, tabStop)
      : null;
    const strip = alone ?? indent;
    const width = context.width - strip;
    // The first line's text starts where the marker as printed ends, past
    // the columns continuation lines strip.
    const markerEnd =
      (opening ? context.column : 0) + expandTabs(first, tabStop).length;
    const head = alone === null ? Math.max(0, markerEnd - strip) : 0;
    const within = { ...context, inListItem: true, width, column: head };
    const body = printIn(item, inner, 0, inner.text.length, within, options);
    if (body === null) return null;
    if (definitions || out !== '') {
      out += hasBlankLine(view.text.slice(end, line)) ? '\n\n' : '\n';
    }
    if (alone !== null) {
      const rest = ' '.repeat(strip);
      out += `${first.trimEnd()}\n${prefixed(body, rest, rest)}`;
    } else {
      out += prefixed(body, first, ' '.repeat(strip));
    }
    end = extent(item.at(-1), view)[1];
  }
  return { text: out, end };
}

/**
 * @param {object} block
 * @param {View} view
 * @param {Context} context
 * @param {object} options
 */
function printList(block, view, context, options) {
  const items = block.t === 'OrderedList' ? block.c[1] : block.c;
  const start = extent(block, view)[0];
  return printItems(items, view, start, false, context, options)?.text ?? null;
}

/**
 * A definition list: each term's line as written, its definitions as
 * items.
 *
 * @param {object} block
 * @param {View} view
 * @param {Context} context
 * @param {object} options
 */
function printDefinitionList(block, view, context, options) {
  const start = extent(block, view)[0];
  let out = '';
  let end = null;
  for (const [term, definitions] of block.c) {
    if (term.length === 0) return null;
    // The first term's line up to the list printed before it.
    const line = Math.max(
      start,
      lineStart(view.text, view.start(term[0].start)),
    );
    const termEnd = view.text.indexOf('\n', view.end(term.at(-1).end));
    if (termEnd < 0 || (end !== null && line < end)) return null;
    if (end !== null) {
      out += hasBlankLine(view.text.slice(end, line)) ? '\n\n' : '\n';
    }
    out += view.text.slice(line, termEnd);
    const defs = printItems(definitions, view, termEnd, true, context, options);
    if (defs === null) return null;
    out += defs.text;
    end = defs.end;
  }
  return out;
}

const FENCE = /^[ \t]*:{3,}/;
const CLOSER = /^[ \t]*:{3,}[ \t]*$/;

/**
 * A fenced div: its fences as written, its blocks printed in a div. Null for
 * one from HTML.
 *
 * @param {object} block
 * @param {View} view
 * @param {Context} context
 * @param {object} options
 */
function printDiv(block, view, context, options) {
  const { text } = view;
  const [start, end] = extent(block, view);
  const openEnd = text.indexOf('\n', start);
  if (openEnd < 0 || openEnd >= end) return null;
  const open = text.slice(start, openEnd);
  if (!FENCE.test(open)) return null;
  const closeStart = lineStart(text, end);
  const close = text.slice(closeStart, end);
  const closed = closeStart > openEnd && CLOSER.test(close);
  const within = { ...context, divLevel: context.divLevel + 1, column: 0 };
  const to = closed ? closeStart : end;
  const body = printIn(block.c[1], view, openEnd + 1, to, within, options);
  if (body === null) return null;
  const lines = [
    open,
    ...(body === '' ? [] : [body]),
    ...(closed ? [close] : []),
  ];
  return lines.join('\n');
}

/**
 * A paragraph, or plain text in a tight item, through its words
 * (wrap.js).
 *
 * @param {object} block
 * @param {View} view
 * @param {Context} context
 * @param {object} options
 */
function printPara(block, view, context, options) {
  return reflow(block, view, options, context);
}

const PRINTERS = {
  Para: printPara,
  Plain: printPara,
  BlockQuote: (block, view, context, options) => {
    const { contents } = block.c;
    if (contents === undefined) return null;
    const inner = contentsView(contents);
    const within = { ...context, width: context.width - 2, column: 0 };
    const body = printIn(block.c, inner, 0, inner.text.length, within, options);
    if (body === null) return null;
    // Spaces before its first marker that its span takes print as written.
    const start = view.start(block.start);
    const indent = /^[ \t]*/.exec(view.text.slice(start))[0];
    return prefixed(body, `${indent}> `, '> ');
  },
  BulletList: printList,
  OrderedList: printList,
  DefinitionList: printDefinitionList,
  Div: printDiv,
  CodeBlock: printCode,
};

// The column the end of `out` is at.
export const columnAfter = (out) => out.length - lineStart(out, out.length);

/**
 * A block printed in `view`: by its kind, or as written.
 *
 * @param {{t: string, start: number, end: number}} block
 * @param {View} view
 * @param {Context} context
 * @param {object} options
 * @returns {string}
 */
export function printBlock(block, view, context, options) {
  const printed = PRINTERS[block.t]?.(block, view, context, options) ?? null;
  if (printed !== null) return printed;
  const [start, end] = extent(block, view);
  return view.text.slice(start, end);
}
