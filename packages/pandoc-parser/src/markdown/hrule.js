// Thematic breaks.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`.

import * as B from '../ast/builder.js';
import { newline } from '../char.js';
import { attempt, FAIL } from '../core.js';
import { optionalBlanklines, skipSpaces } from '../parsing/general.js';

const isHruleChar = (c) => c === '*' || c === '-' || c === '_';

/**
 * Three or more of `*`, `-` or `_`, one of them, spaces between them
 * allowed: a thematic break.
 *
 * @see Text.Pandoc.Readers.Markdown.hrule
 */
export const hrule = attempt((ctx) => {
  const start = ctx.pos;
  skipSpaces(ctx);
  const c = ctx.text[ctx.pos];
  if (!isHruleChar(c)) return FAIL;
  ctx.pos++;
  for (let k = 0; k < 2; k++) {
    skipSpaces(ctx);
    if (ctx.text[ctx.pos] !== c) return FAIL;
    ctx.pos++;
  }
  while (ctx.text[ctx.pos] === c || ctx.text[ctx.pos] === ' ') ctx.pos++;
  const end = ctx.pos;
  if (newline(ctx) === FAIL || optionalBlanklines(ctx) === FAIL) return FAIL;
  return B.horizontalRule(start, end);
});
