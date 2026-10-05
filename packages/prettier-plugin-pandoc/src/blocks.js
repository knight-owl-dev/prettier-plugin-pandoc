// Blocks printed in a view of the text: a container from the contents the
// parser read, its prefixes rebuilt; a paragraph reflowed (wrap.js); any
// other block as written. A list item's marker and a fence print as
// written too.

import { readMarkdown } from '@knight-owl-dev/pandoc-parser';
import { printCode } from './code.js';
import { edited, markerEdits } from './emphasis.js';
import { alignedPipeTable } from './tables.js';
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
export const contentsView = (contents) => ({
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

// A gap without the indentation before the block after it, where that is
// short of a tab stop: Pandoc reads it no differently.
function unindented(gap, options) {
  const indent = /(?:^|\n)( *)$/.exec(gap)[1];
  return indent.length > 0 && indent.length < options.pandocTabStop
    ? gap.slice(0, gap.length - indent.length)
    : gap;
}

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
export function printIn(blocks, view, from, to, context, options) {
  const ignored = ignoredOf(blocks);
  let out = '';
  let at = from;
  for (const [k, block] of blocks.entries()) {
    const [start, end] = extent(block, view);
    if (start < at) return null;
    if (ignored.has(k) || ignored.has(k - 1)) {
      out += view.text.slice(at, start);
    } else {
      const gap = collapsed(view.text.slice(at, start), k === 0, false);
      const startsLine = k === 0 || gap.includes('\n');
      out +=
        block.t === 'CodeBlock' || !startsLine ? gap : unindented(gap, options);
    }
    // On the first line, past the context's column; on others, from 0.
    const column = out.includes('\n')
      ? columnAfter(out)
      : context.column + out.length;
    const fresh = /\n[ \t]*\n[ \t]*$/.test(out);
    const siblings = siblingsBefore(blocks, k);
    const here = { ...context, column, fresh, siblings };
    out += ignored.has(k)
      ? view.text.slice(start, end)
      : printBlock(block, view, here, options);
    at = end;
  }
  if (at > to) return null;
  return out + collapsed(view.text.slice(at, to), blocks.length === 0, true);
}

/**
 * How many blocks of `blocks[k]`'s kind run right before it: prettier
 * alternates a list's bullet after a sibling list.
 *
 * @param {{t: string}[]} blocks
 * @param {number} k
 */
export function siblingsBefore(blocks, k) {
  let n = 0;
  while (k - n - 1 >= 0 && blocks[k - n - 1].t === blocks[k].t) n++;
  return n;
}

const IGNORE = /^<!--\s*prettier-ignore\s*-->$/;
const IGNORE_START = /^<!--\s*prettier-ignore-start\s*-->$/;
const IGNORE_END = /^<!--\s*prettier-ignore-end\s*-->$/;

// An HTML comment's text, trimmed; null for any other block.
const commentOf = (block) =>
  block.t === 'RawBlock' && block.c[0] === 'html' ? block.c[1].trim() : null;

/**
 * The blocks prettier leaves as written, by index: the one after
 * `<!-- prettier-ignore -->`, and each between `<!-- prettier-ignore-start
 * -->` and `<!-- prettier-ignore-end -->`, or the end where none follows.
 *
 * @param {object[]} blocks
 * @returns {Set<number>}
 */
export function ignoredOf(blocks) {
  const out = new Set();
  let inRange = false;
  for (const [k, block] of blocks.entries()) {
    const comment = commentOf(block);
    if (inRange) {
      if (comment !== null && IGNORE_END.test(comment)) inRange = false;
      else out.add(k);
    } else if (comment !== null && IGNORE_START.test(comment)) {
      inRange = true;
    } else if (comment !== null && IGNORE.test(comment)) {
      if (k + 1 < blocks.length) out.add(k + 1);
    }
  }
  return out;
}

/**
 * `body`'s lines, the first after `first` and each other after `rest`; a
 * blank one after either with its spaces left out.
 *
 * @param {string} body
 * @param {string} first
 * @param {string} rest
 */
export function prefixed(body, first, rest) {
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
 * @param {string[] | null} [markers] Each item's marker, where it changes.
 * @returns {{text: string, end: number} | null}
 */
function printItems(
  items,
  view,
  after,
  definitions,
  context,
  options,
  markers = null,
) {
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
    const written = opening
      ? view.text.slice(Math.max(line, after), at)
      : marker;
    const first = markers?.[out === '' ? 0 : items.indexOf(item)] ?? written;
    const inner = contentsView(contents);
    // Spaces Pandoc left before the first line's text, five past the marker
    // or part of a tab, print as written.
    if (/^[ \t]+\S/.test(inner.text)) return null;
    // Contents starting on the line after the marker stay there, below the
    // marker alone, as far in as Pandoc strips after it.
    const alone = /^[ \t]*\n/.test(inner.text)
      ? indentAfter(expandTabs(first, tabStop).trimEnd(), definitions, tabStop)
      : null;
    // A new marker's content starts after it, one space on.
    const strip = alone ?? (first === written ? indent : first.length);
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
  const markers = markersOf(block, items, view, context, options);
  const printed = printItems(
    items,
    view,
    start,
    false,
    context,
    options,
    markers,
  );
  return printed?.text ?? null;
}

/**
 * Each item's marker as prettier prints it: a bullet `- `, or `* ` after
 * a sibling bullet list; a decimal list's number counting on from its
 * start, or 1 after the first where the source numbers the second 1, its
 * delimiter as written: Pandoc reads it into the list's attributes. Null
 * for any other marker, which prints as written.
 *
 * @see prettier's src/language-markdown/printer-markdown.js (printList)
 * @param {object} block
 * @param {object[][]} items
 * @param {View} view
 * @param {Context} context
 * @param {{pandocTabStop: number}} options
 * @returns {string[] | null}
 */
function markersOf(block, items, view, context, options) {
  if (block.t === 'BulletList') {
    return items.map(() => ((context.siblings ?? 0) % 2 === 0 ? '- ' : '* '));
  }
  const [start, { t: style }, { t: delim }] = block.c[0];
  if (style !== 'Decimal' || (delim !== 'Period' && delim !== 'OneParen')) {
    return null;
  }
  const numbers = items.map((item) => {
    const found =
      item.contents && markerOf(item.contents, view, options.pandocTabStop);
    return Number(/\d+/.exec(found?.marker ?? '')?.[0] ?? Number.NaN);
  });
  const ones = numbers[1] === 1 && (numbers[0] !== 0 || numbers[2] === 1);
  const mark = delim === 'Period' ? '.' : ')';
  return items.map(
    (_, k) => `${k === 0 ? start : ones ? 1 : start + k}${mark} `,
  );
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
const HTML_OPEN = /^[ \t]*<div(\s[^>]*)?>[ \t]*$/i;
const HTML_CLOSE = /^[ \t]*<\/div\s*>[ \t]*$/i;

/**
 * A div, fenced or from HTML: its fences or tags as written, its blocks
 * printed in the div. Null where a tag shares its line with other text.
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
  const html = HTML_OPEN.test(open);
  if (!html && !FENCE.test(open)) return null;
  const closeStart = lineStart(text, end);
  const close = text.slice(closeStart, end);
  const closed =
    closeStart > openEnd && (html ? HTML_CLOSE : CLOSER).test(close);
  // A closing tag sharing its line with text.
  if (html && !closed && /<\/div\s*>[ \t]*$/i.test(close)) return null;
  const within = html
    ? { ...context, inHtmlBlock: 'div', column: 0 }
    : { ...context, divLevel: context.divLevel + 1, column: 0 };
  const to = closed ? closeStart : end;
  const printed = printIn(block.c[1], view, openEnd + 1, to, within, options);
  if (printed === null) return null;
  // An HTML block keeps a blank line written next to a tag.
  const blank = (line) => html && /^[ \t]*$/.test(line ?? 'x');
  const inner = text.slice(openEnd + 1, to).split('\n');
  const body =
    printed === ''
      ? ''
      : `${blank(inner[0]) ? '\n' : ''}${printed}${closed && blank(inner.at(-2)) ? '\n' : ''}`;
  const lines = [
    open,
    ...(body === '' ? [] : [body]),
    ...(closed ? [close] : []),
  ];
  return lines.join('\n');
}

const ATTRIBUTES = /^\{[^}]*\}$/;

/**
 * A heading in ATX form, as prettier prints one: `#` per level, one space,
 * its text with prettier's emphasis markers, its attributes as written; no
 * closing hashes, and a setext heading's underline gone. Null for an empty
 * heading, one whose text spans lines, and one starting mid-line, after
 * raw TeX: ATX starts a line.
 *
 * @param {object} block
 * @param {View} view
 * @param {Context} context
 */
function printHeader(block, view, context) {
  const [level, , inlines] = block.c;
  if (inlines.length === 0 || context.column > 0) return null;
  const { text } = view;
  const [start, end] = extent(block, view);
  const from = view.start(inlines[0].start);
  const to = view.end(inlines.at(-1).end);
  if (from < start || to > end || text.slice(from, to).includes('\n')) {
    return null;
  }
  const lineEnd = text.indexOf('\n', to);
  let rest = text.slice(to, lineEnd < 0 || lineEnd > end ? end : lineEnd);
  // An ATX heading's closing hashes, before its attributes.
  if (/^ {0,3}#/.test(text.slice(start, from))) {
    rest = rest.trim().replace(/^#+(?=\s|$)/, '');
  }
  rest = rest.trim();
  if (rest !== '' && !ATTRIBUTES.test(rest)) return null;
  const edits = markerEdits(inlines, view).sort((a, b) => a.from - b.from);
  const content = edited(text, from, to, edits);
  return `${'#'.repeat(level)} ${content}${rest === '' ? '' : ` ${rest}`}`;
}

const CAPTION_MARKER = /^ {0,3}([Tt]able:|:)[ \t]*$/;

/**
 * A table: a pipe table's rows aligned (tables.js), its caption as a
 * paragraph after its marker and a space; the rest as written.
 *
 * @param {object} block
 * @param {View} view
 * @param {Context} context
 * @param {object} options
 */
function printTable(block, view, context, options) {
  const { text } = view;
  const [start, end] = extent(block, view);
  const edits = [
    alignedPipeTable(block, view),
    captionEdit(block, view, context, options),
  ]
    .filter((edit) => edit !== null && start <= edit.from && edit.to <= end)
    .sort((a, b) => a.from - b.from);
  if (edits.length === 0) return null;
  let out = '';
  let at = start;
  for (const edit of edits) {
    if (edit.from < at) return null;
    out += text.slice(at, edit.from) + edit.text;
    at = edit.to;
  }
  return out + text.slice(at, end);
}

// A caption's paragraph after its marker and a space, as an edit of the
// line it starts on through its end.
function captionEdit(block, view, context, options) {
  const [, [, captionBlocks]] = block.c;
  if (captionBlocks.length !== 1 || captionBlocks[0].t !== 'Plain') return null;
  const [caption] = captionBlocks;
  const { text } = view;
  const [from, to] = [view.start(caption.start), view.end(caption.end)];
  const line = lineStart(text, from);
  const marker = CAPTION_MARKER.exec(text.slice(line, from))?.[1];
  if (marker === undefined) return null;
  const here = { ...context, column: marker.length + 1 };
  const words = reflow(caption, view, options, here);
  return words === null ? null : { from: line, to, text: `${marker} ${words}` };
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
    // A quote opening mid-line, after raw TeX, starts at that column.
    const within = { ...context, width: context.width - 2 };
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
  Table: printTable,
  Header: printHeader,
  // After a line of text, `---` would underline a setext heading.
  HorizontalRule: (_block, _view, context) => (context.fresh ? '---' : null),
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
