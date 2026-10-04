// Raw TeX in Markdown: LaTeX blocks and inlines, which end where Pandoc's
// LaTeX reader's parse of them ends, and ConTeXt environments.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. The LaTeX
// side is `latex/reader.js`.

import * as B from '../ast/builder.js';
import { anyChar, char, digit, letter, newline, string } from '../char.js';
import { alt, attempt, FAIL, many, many1, manyTill, option } from '../core.js';
import { rawLaTeXBlock, rawLaTeXInline } from '../latex/reader.js';
import { notAhead, spaceChar, textOf } from '../parsing/general.js';
import { whenEnabled } from '../parsing/state.js';
import { trim } from '../shared.js';

/** @typedef {import('../parsing/general.js').Context} Context */

/**
 * Spaces, and a newline with spaces after it where no blank line follows:
 * as written.
 *
 * @see Text.Pandoc.Readers.Markdown.spnl'
 */
const spnlText = attempt((ctx) => {
  const xs = textOf(many(spaceChar))(ctx);
  const ys = option(
    '',
    attempt((c) => {
      const from = c.pos;
      if (newline(c) === FAIL || many(spaceChar)(c) === FAIL) return FAIL;
      if (c.text[c.pos] === '\n') return FAIL;
      return c.text.slice(from, c.pos);
    }),
  )(ctx);
  return xs + ys;
});

/**
 * `parser`'s characters in brackets, as written.
 *
 * @see Text.Pandoc.Readers.Markdown.inBrackets
 * @param {import('../core.js').Parser<string>} parser
 */
const inBrackets = (parser) => (ctx) => {
  if (char('[')(ctx) === FAIL) return FAIL;
  const contents = many(parser)(ctx);
  if (contents === FAIL || char(']')(ctx) === FAIL) return FAIL;
  return `[${contents.join('')}]`;
};

const completionOf = alt(inBrackets(alt(letter, digit, spaceChar)), (ctx) => {
  const cs = many1(letter)(ctx);
  return cs === FAIL ? FAIL : cs.join('');
});

/**
 * `\startname … \stopname`, nested ones whole: ConTeXt's environment, as
 * written.
 *
 * @see Text.Pandoc.Readers.Markdown.rawConTeXtEnvironment
 * @type {import('../core.js').Parser<string>}
 */
export const rawConTeXtEnvironment = attempt((ctx) => {
  if (string('\\start')(ctx) === FAIL) return FAIL;
  const completion = completionOf(ctx);
  if (completion === FAIL) return FAIL;
  const stop = attempt((c) =>
    string('\\stop')(c) === FAIL ? FAIL : string(completion)(c),
  );
  const contents = manyTill(alt(rawConTeXtEnvironment, anyChar), stop)(ctx);
  if (contents === FAIL) return FAIL;
  return `\\start${completion}${contents.join('')}\\stop${completion}`;
});

// Raw blocks of one kind, each with the space after it, and where the
// last of them ends.
const chunks = (p) => (ctx) => {
  let end = ctx.pos;
  const one = (c) => {
    const t = p(c);
    if (t === FAIL) return FAIL;
    end = c.pos;
    const s = spnlText(c);
    return s === FAIL ? FAIL : t + s;
  };
  const xs = many1(one)(ctx);
  return xs === FAIL ? FAIL : [xs.join(''), end];
};

/**
 * Raw TeX blocks, ConTeXt's or LaTeX's, as one raw block; none for macro
 * definitions read with `latex_macros`, which leave only space.
 *
 * @see Text.Pandoc.Readers.Markdown.rawTeXBlock
 * @type {import('../core.js').Parser<B.Blocks>}
 */
export const rawTeXBlock = whenEnabled('raw_tex', (ctx) => {
  const start = ctx.pos;
  const r = alt(chunks(rawConTeXtEnvironment), chunks(rawLaTeXBlock))(ctx);
  if (r === FAIL) return FAIL;
  const [text, end] = r;
  const cs = trim(text);
  // don't create a raw block for suppressed macro defs
  if (/^[ \t\n]*$/.test(cs)) return [];
  return B.rawBlock('tex', cs, start, end);
});

const noConTeXt = notAhead(rawConTeXtEnvironment);

/**
 * A raw LaTeX inline; "tex", as it might be ConTeXt.
 *
 * @see Text.Pandoc.Readers.Markdown.rawLaTeXInline'
 * @type {import('../core.js').Parser<B.Inlines>}
 */
export const rawLaTeXInlinePrime = whenEnabled('raw_tex', (ctx) => {
  const start = ctx.pos;
  if (noConTeXt(ctx) === FAIL) return FAIL;
  const s = rawLaTeXInline(ctx);
  return s === FAIL ? FAIL : B.rawInline('tex', s, start, ctx.pos);
});
