// Line blocks: `| ` lines, each read again as inlines.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`.

import * as B from '../ast/builder.js';
import { attempt, FAIL } from '../core.js';
import {
  blockEnd,
  lineBlockLines,
  parseFromStringFresh,
} from '../parsing/general.js';
import { whenEnabled } from '../parsing/state.js';
import { inlines } from './inlines.js';

/**
 * A line block: its lines, each read again as inlines and trimmed.
 *
 * @see Text.Pandoc.Readers.Markdown.lineBlock
 */
export const lineBlock = whenEnabled(
  'line_blocks',
  attempt((ctx) => {
    const start = ctx.pos;
    const lines = lineBlockLines(ctx);
    if (lines === FAIL) return FAIL;
    const read = [];
    for (const line of lines) {
      const ils = parseFromStringFresh(ctx, inlines, line);
      if (ils === FAIL) return FAIL;
      read.push(B.trimInlines(ils));
    }
    const end = blockEnd(ctx.text, start, ctx.pos, read.flat());
    return B.lineBlock(read, start, end);
  }),
);
