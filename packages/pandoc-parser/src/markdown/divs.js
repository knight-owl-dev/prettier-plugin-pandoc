// Fenced divs: blocks between `:::` fences, attributes or a class on the
// opening one.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `blocks.js`
// imports this module and this one `blocks.js`, as do the parsers asking
// for a closing fence: what they import from here is a function declaration,
// and what this reads from `blocks.js`, it reads when called.

import * as B from '../ast/builder.js';
import { char, string } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  many,
  notFollowedBy,
  skipMany,
  skipMany1,
} from '../core.js';
import { message, report } from '../logging.js';
import {
  blankline,
  blanklines,
  blockEnd,
  nonspaceChar,
  skipSpaces,
  textOf,
} from '../parsing/general.js';
import { enabled, updateState } from '../parsing/state.js';
import { attributes } from './attributes.js';
import { block } from './blocks.js';

/** @typedef {import('../core.js').Context} Context */

const fence = string(':::');
const colons = skipMany(char(':'));
const closer = attempt((ctx) =>
  fence(ctx) === FAIL || colons(ctx) === FAIL ? FAIL : blanklines(ctx),
);
const notCloser = notFollowedBy(closer);

/**
 * A closing fence: `:::` or more, then blank lines.
 *
 * @see Text.Pandoc.Readers.Markdown.divFenceEnd
 * @param {Context} ctx
 */
export function divFenceEnd(ctx) {
  return closer(ctx);
}

/**
 * No closing fence of an open div here.
 *
 * @see Text.Pandoc.Readers.Markdown.notFollowedByDivCloser
 * @param {Context} ctx
 */
export function notFollowedByDivCloser(ctx) {
  return inDiv(ctx) ? notCloser(ctx) : undefined;
}

/**
 * Whether the parse is in a fenced div.
 *
 * @param {Context} ctx
 */
export function inDiv(ctx) {
  return ctx.state.fencedDivLevel > 0 && enabled(ctx, 'fenced_divs');
}

const className = textOf(skipMany1(nonspaceChar));
const bareClass = (ctx) => {
  const name = className(ctx);
  return name === FAIL ? FAIL : ['', [name], []];
};
const divAttributes = alt(attributes, bareClass);
const contents = many((ctx) => (notCloser(ctx) === FAIL ? FAIL : block(ctx)));

const level = (ctx, by) =>
  updateState(ctx, { fencedDivLevel: ctx.state.fencedDivLevel + by });

/**
 * A div: an opening fence and its attributes, then blocks to a closing
 * fence, or to where the blocks end where none closes it, logged.
 *
 * @see Text.Pandoc.Readers.Markdown.divFenced
 * @param {Context} ctx
 */
export function divFenced(ctx) {
  return enabled(ctx, 'fenced_divs') ? fenced(ctx) : FAIL;
}

const fenced = attempt((ctx) => {
  const start = ctx.pos;
  if (fence(ctx) === FAIL) return FAIL;
  colons(ctx);
  skipSpaces(ctx);
  const attr = divAttributes(ctx);
  if (attr === FAIL) return FAIL;
  skipSpaces(ctx);
  colons(ctx);
  if (blankline(ctx) === FAIL) return FAIL;
  level(ctx, 1);
  const bs = contents(ctx);
  if (bs === FAIL) return FAIL;
  if (closer(ctx) === FAIL) report(ctx, message('UnclosedDiv', start, ctx.pos));
  level(ctx, -1);
  const blocks = bs.flat();
  const end = blockEnd(ctx.text, start, ctx.pos, blocks);
  return B.divWith(attr, blocks, start, end);
});
