// Definition lists: a term on a line of its own, then definitions, each a
// list item opened by `:` or `~`.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `blocks.js`
// imports this module, which imports modules that import `blocks.js`: what
// `blocks.js` imports from here is a function declaration, and what this
// reads from those modules, it reads when called.

import * as B from '../ast/builder.js';
import { Node } from '../ast/nodes.js';
import {
  attempt,
  FAIL,
  lookAhead,
  many1,
  notFollowedBy,
  optional,
} from '../core.js';
import {
  anyLine,
  blankline,
  blanklines,
  blockEnd,
  optionalBlanklines,
  parseFromStringFresh,
} from '../parsing/general.js';
import { enabled } from '../parsing/state.js';
import { SourceText } from '../source-text.js';
import { inlines } from './inlines.js';
import { defListStart, listItem } from './lists.js';
import { table } from './tables.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {import('../ast/nodes.js').Node} Node */

/**
 * A paragraph as a plain block: a tight list's.
 *
 * @see Text.Pandoc.Readers.Markdown.paraToPlain
 * @param {Node} block
 */
const paraToPlain = (block) =>
  block.t === 'Para'
    ? new Node('Plain', block.c, block.start, block.end)
    : block;

// The definitions of a term, by whether the four-space rule holds.
const definitionsOf = new Map();
function definitions(fourSpaceRule) {
  let parser = definitionsOf.get(fourSpaceRule);
  if (parser === undefined) {
    parser = many1(listItem(fourSpaceRule, defListStart));
    definitionsOf.set(fourSpaceRule, parser);
  }
  return parser;
}

/**
 * A term, its line read again as inlines, and its definitions; their
 * paragraphs plain where no blank line follows the term.
 *
 * @see Text.Pandoc.Readers.Markdown.definitionListItem
 * @type {import('../core.js').Parser<[Node[], Node[][]]>}
 */
const definitionListItem = attempt((ctx) => {
  const from = ctx.pos;
  const line = anyLine(ctx);
  if (line === FAIL) return FAIL;
  const termText = SourceText.slice(ctx.text, from, from + line.length);
  const term = parseFromStringFresh(ctx, inlines, termText);
  if (term === FAIL) return FAIL;
  const tight = blanklines(ctx) === FAIL;
  const read = definitions(enabled(ctx, 'four_space_rule'))(ctx);
  if (read === FAIL || optionalBlanklines(ctx) === FAIL) return FAIL;
  const defs = tight ? read.map((blocks) => blocks.map(paraToPlain)) : read;
  return [B.trimInlines(term), defs];
});

const definitionItems = many1(definitionListItem);
const notTable = notFollowedBy(table);
// A blank line, then no table: the marker would be a caption's, before it.
const maybeBlankline = optional((ctx) =>
  blankline(ctx) === FAIL ? FAIL : notTable(ctx),
);
const opens = lookAhead((ctx) =>
  anyLine(ctx) === FAIL || maybeBlankline(ctx) === FAIL
    ? FAIL
    : defListStart(ctx),
);

/**
 * Terms and their definitions, where `definition_lists` is on and a
 * definition's marker follows the first term, a blank line between them
 * or none.
 *
 * @see Text.Pandoc.Readers.Markdown.definitionList
 * @param {Context} ctx
 */
export function definitionList(ctx) {
  return definitionListAt(ctx);
}

const definitionListAt = attempt((ctx) => {
  if (!enabled(ctx, 'definition_lists')) return FAIL;
  const start = ctx.pos;
  if (opens(ctx) === FAIL) return FAIL;
  const items = definitionItems(ctx);
  if (items === FAIL) return FAIL;
  const last = items.at(-1)[1].at(-1);
  const end = blockEnd(ctx.text, start, ctx.pos, last);
  return B.definitionList(items, start, end);
});
