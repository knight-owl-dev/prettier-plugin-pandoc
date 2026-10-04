// Bullet and ordered lists: each item's lines extracted, its indentation
// dropped, and read again as blocks.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. Parsers that ask
// whether a list starts import this module, and it imports `blocks.js`: what
// they import from here is a function declaration, and what it reads from
// them, it reads when called.

import * as B from '../ast/builder.js';
import { DefaultDelim, DefaultStyle } from '../ast/nodes.js';
import { char, digit, newline, string } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  many1,
  notFollowedBy,
  optional,
} from '../core.js';
import {
  anyLine,
  blankline,
  blockEnd,
  gobbleAtMostSpaces,
  gobbleSpaces,
  notAhead,
  parseFromStringFresh,
  skipSpaces,
  spaceChar,
  textOf,
} from '../parsing/general.js';
import {
  anyOrderedListMarker,
  orderedListMarker,
  readInt,
} from '../parsing/lists.js';
import { enabled, updateState } from '../parsing/state.js';
import { columnOf } from '../position.js';
import { compactify, taskListItemFromAscii } from '../shared.js';
import { SourceText } from '../source-text.js';
import { parseBlocks } from './blocks.js';
import { codeBlockFenced } from './code.js';
import { skipNonindentSpaces } from './common.js';
import { notFollowedByDivCloser } from './divs.js';
import { hrule } from './hrule.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../ast/nodes.js').Node} Node */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */

const maybeNewline = optional(newline);
const noHrule = notAhead(hrule);
const noSpaceChar = notFollowedBy(spaceChar);
const newlineAhead = lookAhead(newline);

// After a marker: a space, or the line's end.
const markerSpace = (ctx) =>
  gobbleSpaces(ctx, 1) === FAIL && newlineAhead(ctx) === FAIL
    ? FAIL
    : undefined;

// Then up to three more spaces, unless a fourth follows.
function extraSpaces(ctx) {
  const { pos } = ctx;
  gobbleAtMostSpaces(ctx, 3);
  if (noSpaceChar(ctx) === FAIL) ctx.pos = pos;
}

/**
 * A bullet, `*`, `+` or `-`, not opening a thematic break.
 *
 * @see Text.Pandoc.Readers.Markdown.bulletListStart
 */
export const bulletListStart = attempt((ctx) => {
  maybeNewline(ctx);
  if (skipNonindentSpaces(ctx) === FAIL || noHrule(ctx) === FAIL) return FAIL;
  const c = ctx.text[ctx.pos];
  if (c !== '*' && c !== '+' && c !== '-') return FAIL;
  ctx.pos++;
  if (markerSpace(ctx) === FAIL) return FAIL;
  extraSpaces(ctx);
  return undefined;
});

const pageNumberAhead = attempt((ctx) =>
  string('p.')(ctx) === FAIL || spaceChar(ctx) === FAIL ? FAIL : digit(ctx),
);
const noPageNumber = notFollowedBy(pageNumberAhead);
const digits = textOf(many1(digit));
const period = char('.');
// Roman numerals an initial could be: `I.`, `V.`, `X.` and on.
const ROMAN_INITIALS = new Set([1, 5, 10, 50, 100, 500, 1000]);
const secondSpaceAhead = lookAhead(alt(newline, spaceChar));

// After a marker that could be an initial, a second space.
function initialGuard(ctx, [num, style, delim]) {
  const initial =
    delim.t === 'Period' &&
    (style.t === 'UpperAlpha' ||
      (style.t === 'UpperRoman' && ROMAN_INITIALS.has(num)));
  return initial ? secondSpaceAhead(ctx) : undefined;
}

// A decimal marker and its period, `fancy_lists` off.
function plainMarker(ctx) {
  const n = digits(ctx);
  if (n === FAIL || period(ctx) === FAIL || markerSpace(ctx) === FAIL) {
    return FAIL;
  }
  extraSpaces(ctx);
  return [readInt(n), DefaultStyle, DefaultDelim];
}

// A marker `marker` reads, then its spaces.
const fancyMarker = (marker) => (ctx) => {
  const attrs = marker(ctx);
  if (attrs === FAIL || markerSpace(ctx) === FAIL) return FAIL;
  if (initialGuard(ctx, attrs) === FAIL) return FAIL;
  extraSpaces(ctx);
  return attrs;
};

// An ordered marker: with `fancy_lists` off a plain one first, and where
// that reads no digit, as with it on, one `fancy` reads.
const orderedStart = (fancy) => {
  const marker = alt(
    (ctx) => (enabled(ctx, 'fancy_lists') ? FAIL : plainMarker(ctx)),
    fancy,
  );
  return attempt((ctx) => {
    maybeNewline(ctx);
    if (skipNonindentSpaces(ctx) === FAIL || noPageNumber(ctx) === FAIL) {
      return FAIL;
    }
    return marker(ctx);
  });
};

const anyOrderedStart = orderedStart(fancyMarker(anyOrderedListMarker));
const orderedStarts = new Map();

/**
 * An ordered list's marker: of any style and delimiter where `styleDelim`
 * is null, else of those, which `#` stands in for. Its list attributes.
 *
 * @see Text.Pandoc.Readers.Markdown.orderedListStart
 * @param {[{t: string}, {t: string}] | null} styleDelim
 * @returns {Parser<[number, {t: string}, {t: string}]>}
 */
export function orderedListStart(styleDelim) {
  if (styleDelim === null) return anyOrderedStart;
  const key = `${styleDelim[0].t} ${styleDelim[1].t}`;
  let parser = orderedStarts.get(key);
  if (parser === undefined) {
    const marker = orderedListMarker(...styleDelim);
    parser = orderedStart(
      fancyMarker((ctx) => {
        const start = marker(ctx);
        return start === FAIL ? FAIL : [start, ...styleDelim];
      }),
    );
    orderedStarts.set(key, parser);
  }
  return parser;
}

const defMarker = alt(char(':'), char('~'));

/**
 * A definition's marker, `:` or `~`.
 *
 * @see Text.Pandoc.Readers.Markdown.defListStart
 * @param {Context} ctx
 */
export function defListStart(ctx) {
  if (skipNonindentSpaces(ctx) === FAIL || defMarker(ctx) === FAIL) {
    return FAIL;
  }
  if (markerSpace(ctx) === FAIL) return FAIL;
  extraSpaces(ctx);
  return undefined;
}

/**
 * Any list's start: a bullet, an ordered marker, or a definition's.
 *
 * @see Text.Pandoc.Readers.Markdown.listStart
 * @param {Context} ctx
 */
export function listStart(ctx) {
  return anyListStart(ctx);
}

const anyListStart = alt(bulletListStart, anyOrderedStart, defListStart);

/**
 * Whether the parse is in a list item.
 *
 * @see Text.Pandoc.Readers.Markdown.inList
 * @param {Context} ctx
 */
export const inList = (ctx) => ctx.state.parserContext === 'ListItemState';

/**
 * A list's start where the parse is in a list item: Haskell's
 * `inList >> listStart`.
 *
 * @param {Context} ctx
 */
export function listStartInItem(ctx) {
  return inList(ctx) ? listStart(ctx) : FAIL;
}

// A line from `from`, newline and all, as extracted text.
const lineFrom = (ctx, from) => SourceText.slice(ctx.text, from, ctx.pos);

// A line after `indent` spaces, the spaces dropped, as extracted text.
const lineAfter = (indent) => (ctx) => {
  if (gobbleSpaces(ctx, indent) === FAIL) return FAIL;
  const from = ctx.pos;
  return anyLine(ctx) === FAIL ? FAIL : lineFrom(ctx, from);
};

// Blank lines, each as its newline alone: Pandoc's `manyChar blankline`.
function blankNewlines(ctx) {
  const parts = [];
  while (blankline(ctx) !== FAIL) {
    parts.push(SourceText.slice(ctx.text, ctx.pos - 1, ctx.pos));
  }
  return parts;
}

const noListStart = notAhead(listStart);
const notFence = notFollowedBy(codeBlockFenced);
const notBlank = notFollowedBy(blankline);

// A list item's line after its first, `indent` spaces of indentation
// dropped where it has them; not one opening a list item at that indentation,
// nor an open div's closing fence. Not ported yet: an HTML block's closer.
// @see Text.Pandoc.Readers.Markdown.listLine
function listLine(indent) {
  const opensItem = notAhead((ctx) => {
    if (gobbleSpaces(ctx, indent) === FAIL) return FAIL;
    skipSpaces(ctx);
    return listStart(ctx);
  });
  return attempt((ctx) => {
    if (opensItem(ctx) === FAIL || notFollowedByDivCloser(ctx) === FAIL) {
      return FAIL;
    }
    gobbleSpaces(ctx, indent);
    const from = ctx.pos;
    return anyLine(ctx) === FAIL ? FAIL : lineFrom(ctx, from);
  });
}

// What a list item takes off each continuation line: its parsers, by
// indentation.
const byIndent = new Map();
function partsFor(indent) {
  let parts = byIndent.get(indent);
  if (parts === undefined) {
    const line = listLine(indent);
    parts = {
      rest: many((ctx) =>
        noListStart(ctx) === FAIL ||
        notFence(ctx) === FAIL ||
        notBlank(ctx) === FAIL
          ? FAIL
          : line(ctx),
      ),
      continuations: many(listContinuation(indent)),
    };
    byIndent.set(indent, parts);
  }
  return parts;
}

/**
 * A list item's first lines: its marker read by `start`, then its lines up
 * to a blank line, another item, or a fence. The lines, and the indentation
 * its continuations take off: the marker's width, or 4.
 *
 * @see Text.Pandoc.Readers.Markdown.rawListItem
 * @param {boolean} fourSpaceRule
 * @param {Parser<unknown>} start
 */
function rawListItem(fourSpaceRule, start) {
  return attempt((ctx) => {
    const from = ctx.pos;
    if (start(ctx) === FAIL) return FAIL;
    const indent = fourSpaceRule
      ? 4
      : columnOf(ctx.text, ctx.pos) - columnOf(ctx.text, from);
    const firstFrom = ctx.pos;
    if (anyLine(ctx) === FAIL) return FAIL;
    const first = lineFrom(ctx, firstFrom);
    const rest = partsFor(indent).rest(ctx);
    if (rest === FAIL) return FAIL;
    const lines = [first, ...rest, ...blankNewlines(ctx)];
    return { text: SourceText.concat(lines), indent };
  });
}

/**
 * A list item's continuation: lines indented by `indent`, the first after
 * a blank line, the rest also lazy where they open no item; blank lines
 * after. None is an open div's closing fence.
 *
 * @see Text.Pandoc.Readers.Markdown.listContinuation
 * @param {number} indent
 */
function listContinuation(indent) {
  const indented = lineAfter(indent);
  const first = attempt((ctx) =>
    notBlank(ctx) === FAIL || notFollowedByDivCloser(ctx) === FAIL
      ? FAIL
      : indented(ctx),
  );
  const rest = many(
    attempt((ctx) => {
      if (notBlank(ctx) === FAIL || notFollowedByDivCloser(ctx) === FAIL) {
        return FAIL;
      }
      if (gobbleSpaces(ctx, indent) === FAIL && noListStart(ctx) === FAIL) {
        return FAIL;
      }
      const from = ctx.pos;
      return anyLine(ctx) === FAIL ? FAIL : lineFrom(ctx, from);
    }),
  );
  return attempt((ctx) => {
    const x = first(ctx);
    if (x === FAIL) return FAIL;
    const xs = rest(ctx);
    if (xs === FAIL) return FAIL;
    return SourceText.concat([x, ...xs, ...blankNewlines(ctx)]);
  });
}

/**
 * A list item, its marker read by `start`: its lines read again as blocks
 * in a list item's context, a task box at its start where there is one.
 *
 * @see Text.Pandoc.Readers.Markdown.listItem
 * @param {boolean} fourSpaceRule
 * @param {Parser<unknown>} start
 * @returns {Parser<Node[]>}
 */
export function listItem(fourSpaceRule, start) {
  const raw = rawListItem(fourSpaceRule, start);
  return attempt((ctx) => {
    const outer = ctx.state.parserContext;
    updateState(ctx, { parserContext: 'ListItemState' });
    const first = raw(ctx);
    if (first === FAIL) return FAIL;
    const continuations = partsFor(first.indent).continuations(ctx);
    if (continuations === FAIL) return FAIL;
    const text = SourceText.concat([first.text, ...continuations]);
    const contents = parseFromStringFresh(ctx, parseBlocks, text);
    if (contents === FAIL) return FAIL;
    updateState(ctx, { parserContext: outer });
    return taskListItemFromAscii(enabled(ctx, 'task_lists'), contents);
  });
}

// List items, each read by `item`, as one parser per kind of list.
const itemParsers = new Map();
function itemsOf(key, item) {
  let items = itemParsers.get(key);
  if (items === undefined) {
    items = many1(item());
    itemParsers.set(key, items);
  }
  return items;
}

/**
 * Bullet list items, tight or loose as a whole.
 *
 * @see Text.Pandoc.Readers.Markdown.bulletList
 * @param {Context} ctx
 */
export function bulletList(ctx) {
  const fourSpaceRule = enabled(ctx, 'four_space_rule');
  const start = ctx.pos;
  const items = itemsOf(`bullet ${fourSpaceRule}`, () =>
    listItem(fourSpaceRule, bulletListStart),
  )(ctx);
  if (items === FAIL) return FAIL;
  const end = blockEnd(ctx.text, start, ctx.pos, items.at(-1));
  return B.bulletList(compactify(items), start, end);
}

const PLAIN_STYLES = new Set(['DefaultStyle', 'Decimal', 'Example']);
const PLAIN_DELIMS = new Set(['DefaultDelim', 'Period']);
const orderedStartAhead = lookAhead(anyOrderedStart);

/**
 * Ordered list items of one style and delimiter: fancy ones with
 * `fancy_lists`, examples with `example_lists`, numbered from the first's
 * start with `startnum`. In a list item, only one starting at 1 opens a
 * list.
 *
 * @see Text.Pandoc.Readers.Markdown.orderedList
 * @param {Context} ctx
 */
export function orderedList(ctx) {
  return orderedItems(ctx);
}

const orderedItems = attempt((ctx) => {
  const begin = ctx.pos;
  const attrs = orderedStartAhead(ctx);
  if (attrs === FAIL) return FAIL;
  const [start, style, delim] = attrs;
  if (inList(ctx) && start !== 1) return FAIL;
  const plain = PLAIN_STYLES.has(style.t) && PLAIN_DELIMS.has(delim.t);
  if (!plain && !enabled(ctx, 'fancy_lists')) return FAIL;
  if (style.t === 'Example' && !enabled(ctx, 'example_lists')) return FAIL;
  const fourSpaceRule =
    enabled(ctx, 'four_space_rule') || style.t === 'Example';
  const items = itemsOf(`${fourSpaceRule} ${style.t} ${delim.t}`, () =>
    listItem(fourSpaceRule, orderedListStart([style, delim])),
  )(ctx);
  if (items === FAIL) return FAIL;
  const number = style.t === 'Example' || enabled(ctx, 'startnum') ? start : 1;
  const end = blockEnd(ctx.text, begin, ctx.pos, items.at(-1));
  return B.orderedListWith(
    [number, style, delim],
    compactify(items),
    begin,
    end,
  );
});
