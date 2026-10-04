// The builder Pandoc's reader makes its AST with: constructors, each a list
// of one node (or none: `plain` of nothing), captions, and the inline list
// operations of `inlines.js`.
//
// Ported from pandoc-types 1.23.1.2's `Text.Pandoc.Builder`. Each takes the
// node's content as Haskell's does, then its source span `start, end`, which
// the reader knows where it parses the node; a container's span holds its
// markup, which its content's spans cannot give. Table builders come with the
// table parser, their normalization with them.

import {
  DefaultDelim,
  DefaultStyle,
  DisplayMath,
  DoubleQuote,
  InlineMath,
  Node,
  nullAttr,
  SingleQuote,
} from './nodes.js';

export { concat, join, text, trimInlines } from './inlines.js';

/** @typedef {import('./inlines.js').Inlines} Inlines */
/** @typedef {Node[]} Blocks */

// A list of the one node `t` with content `c`, spanning `start` to `end`.
const one = (t, c, start, end) => [new Node(t, c, start, end)];

// The constructor of `t` whose content is its one argument.
const content = (t) => (c, start, end) => one(t, c, start, end);

// The constructor of `t`, which has no content.
const nullary = (t) => (start, end) => one(t, undefined, start, end);

/** @see Text.Pandoc.Builder.str */
export const str = content('Str');

/** @see Text.Pandoc.Builder.emph */
export const emph = content('Emph');

/** @see Text.Pandoc.Builder.underline */
export const underline = content('Underline');

/** @see Text.Pandoc.Builder.strong */
export const strong = content('Strong');

/** @see Text.Pandoc.Builder.strikeout */
export const strikeout = content('Strikeout');

/** @see Text.Pandoc.Builder.superscript */
export const superscript = content('Superscript');

/** @see Text.Pandoc.Builder.subscript */
export const subscript = content('Subscript');

/** @see Text.Pandoc.Builder.smallcaps */
export const smallcaps = content('SmallCaps');

/** @see Text.Pandoc.Builder.quoted */
export const quoted = (qt, ils, start, end) =>
  one('Quoted', [qt, ils], start, end);

/** @see Text.Pandoc.Builder.singleQuoted */
export const singleQuoted = (ils, start, end) =>
  quoted(SingleQuote, ils, start, end);

/** @see Text.Pandoc.Builder.doubleQuoted */
export const doubleQuoted = (ils, start, end) =>
  quoted(DoubleQuote, ils, start, end);

/**
 * @see Text.Pandoc.Builder.cite
 * @param {ReturnType<typeof import('./nodes.js').citation>[]} citations
 */
export const cite = (citations, ils, start, end) =>
  one('Cite', [citations, ils], start, end);

/** @see Text.Pandoc.Builder.codeWith */
export const codeWith = (attr, t, start, end) =>
  one('Code', [attr, t], start, end);

/** @see Text.Pandoc.Builder.code */
export const code = (t, start, end) => codeWith(nullAttr, t, start, end);

/** @see Text.Pandoc.Builder.space */
export const space = nullary('Space');

/** @see Text.Pandoc.Builder.softbreak */
export const softbreak = nullary('SoftBreak');

/** @see Text.Pandoc.Builder.linebreak */
export const linebreak = nullary('LineBreak');

/** @see Text.Pandoc.Builder.math */
export const math = (t, start, end) => one('Math', [InlineMath, t], start, end);

/** @see Text.Pandoc.Builder.displayMath */
export const displayMath = (t, start, end) =>
  one('Math', [DisplayMath, t], start, end);

/** @see Text.Pandoc.Builder.rawInline */
export const rawInline = (format, t, start, end) =>
  one('RawInline', [format, t], start, end);

/** @see Text.Pandoc.Builder.linkWith */
export const linkWith = (attr, url, title, ils, start, end) =>
  one('Link', [attr, ils, [url, title]], start, end);

/** @see Text.Pandoc.Builder.link */
export const link = (url, title, ils, start, end) =>
  linkWith(nullAttr, url, title, ils, start, end);

/** @see Text.Pandoc.Builder.imageWith */
export const imageWith = (attr, url, title, ils, start, end) =>
  one('Image', [attr, ils, [url, title]], start, end);

/** @see Text.Pandoc.Builder.image */
export const image = (url, title, ils, start, end) =>
  imageWith(nullAttr, url, title, ils, start, end);

/** @see Text.Pandoc.Builder.note */
export const note = content('Note');

/** @see Text.Pandoc.Builder.spanWith */
export const spanWith = (attr, ils, start, end) =>
  one('Span', [attr, ils], start, end);

/** @see Text.Pandoc.Builder.para */
export const para = content('Para');

/**
 * None for no inlines.
 *
 * @see Text.Pandoc.Builder.plain
 */
export const plain = (ils, start, end) =>
  ils.length === 0 ? [] : one('Plain', ils, start, end);

/**
 * @see Text.Pandoc.Builder.lineBlock
 * @param {Inlines[]} lines
 */
export const lineBlock = content('LineBlock');

/** @see Text.Pandoc.Builder.codeBlockWith */
export const codeBlockWith = (attr, t, start, end) =>
  one('CodeBlock', [attr, t], start, end);

/** @see Text.Pandoc.Builder.codeBlock */
export const codeBlock = (t, start, end) =>
  codeBlockWith(nullAttr, t, start, end);

/** @see Text.Pandoc.Builder.rawBlock */
export const rawBlock = (format, t, start, end) =>
  one('RawBlock', [format, t], start, end);

/** @see Text.Pandoc.Builder.blockQuote */
export const blockQuote = content('BlockQuote');

/**
 * @see Text.Pandoc.Builder.orderedListWith
 * @param {[number, {t: string}, {t: string}]} attrs Start, style, delimiter.
 * @param {Blocks[]} items
 */
export const orderedListWith = (attrs, items, start, end) =>
  one('OrderedList', [attrs, items], start, end);

/**
 * @see Text.Pandoc.Builder.orderedList
 * @param {Blocks[]} items
 */
export const orderedList = (items, start, end) =>
  orderedListWith([1, DefaultStyle, DefaultDelim], items, start, end);

/**
 * @see Text.Pandoc.Builder.bulletList
 * @param {Blocks[]} items
 */
export const bulletList = content('BulletList');

/**
 * @see Text.Pandoc.Builder.definitionList
 * @param {[Inlines, Blocks[]][]} items Each term and its definitions.
 */
export const definitionList = content('DefinitionList');

/** @see Text.Pandoc.Builder.headerWith */
export const headerWith = (attr, level, ils, start, end) =>
  one('Header', [level, attr, ils], start, end);

/** @see Text.Pandoc.Builder.header */
export const header = (level, ils, start, end) =>
  headerWith(nullAttr, level, ils, start, end);

/** @see Text.Pandoc.Builder.horizontalRule */
export const horizontalRule = nullary('HorizontalRule');

/** @see Text.Pandoc.Builder.divWith */
export const divWith = (attr, blocks, start, end) =>
  one('Div', [attr, blocks], start, end);

/**
 * A caption, its short form null for none.
 *
 * @see Text.Pandoc.Builder.caption
 * @param {Inlines | null} short
 * @param {Blocks} blocks
 */
export const caption = (short, blocks) => [short, blocks];

/** @see Text.Pandoc.Builder.simpleCaption */
export const simpleCaption = (blocks) => caption(null, blocks);

/** @see Text.Pandoc.Builder.emptyCaption */
export const emptyCaption = Object.freeze(simpleCaption(Object.freeze([])));

/** @see Text.Pandoc.Builder.figureWith */
export const figureWith = (attr, capt, blocks, start, end) =>
  one('Figure', [attr, capt, blocks], start, end);

/** @see Text.Pandoc.Builder.figure */
export const figure = (capt, blocks, start, end) =>
  figureWith(nullAttr, capt, blocks, start, end);
