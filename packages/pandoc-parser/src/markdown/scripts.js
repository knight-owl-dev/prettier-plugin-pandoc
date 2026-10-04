// Superscript and subscript: text between `^`s or `~`s, no spaces in it,
// read again as inlines.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`.

import * as B from '../ast/builder.js';
import { char, noneOf } from '../char.js';
import { attempt, FAIL, manyTill } from '../core.js';
import { characterReference, parseFromString } from '../parsing/general.js';
import { whenEnabled } from '../parsing/state.js';
import { SourceText } from '../source-text.js';
import { attributes } from './attributes.js';
import { escapedCharacter, unescaped } from './common.js';
import { inlines } from './inlines.js';

const noSpaceChar = noneOf('\n \r\t');

/**
 * A character of text with no spaces in it, as extracted text: an escaped
 * one decoded, an escaped space a non-breaking one; a character reference
 * decoded; attributes as written; any but a space or line break.
 *
 * @see Text.Pandoc.Readers.Markdown.litCharNoSpace
 * @type {import('../core.js').Parser<SourceText>}
 */
function litCharNoSpace(ctx) {
  const start = ctx.pos;
  const escaped = escapedCharacter(ctx);
  if (escaped !== FAIL) {
    return SourceText.synth(unescaped(escaped), start, ctx.pos);
  }
  const reference = characterReference(ctx);
  if (reference !== FAIL) return SourceText.synth(reference, start, ctx.pos);
  if (attributes(ctx) !== FAIL || noSpaceChar(ctx) !== FAIL) {
    return SourceText.slice(ctx.text, start, ctx.pos);
  }
  return FAIL;
}

/**
 * The text between `delimiter`s, no spaces in it, as extracted text.
 *
 * @see Text.Pandoc.Readers.Markdown.litBetweenNoSpace
 * @param {string} delimiter
 */
function litBetweenNoSpace(delimiter) {
  const mark = char(delimiter);
  const body = manyTill(litCharNoSpace, mark);
  return attempt((ctx) => {
    if (mark(ctx) === FAIL) return FAIL;
    const parts = body(ctx);
    return parts === FAIL ? FAIL : SourceText.concat(parts);
  });
}

// Inlines between `delimiter`s, built by `build`, where `extension` is on.
// Not ported yet: `short_subsuperscripts`, off by default.
function script(delimiter, extension, build) {
  const text = litBetweenNoSpace(delimiter);
  return whenEnabled(extension, (ctx) => {
    const start = ctx.pos;
    const source = text(ctx);
    if (source === FAIL) return FAIL;
    const ils = parseFromString(ctx, inlines, source);
    return ils === FAIL ? FAIL : build(ils, start, ctx.pos);
  });
}

/**
 * Text between `^`s, superscript.
 *
 * @see Text.Pandoc.Readers.Markdown.superscript
 */
export const superscript = script('^', 'superscript', B.superscript);

/**
 * Text between `~`s, subscript.
 *
 * @see Text.Pandoc.Readers.Markdown.subscript
 */
export const subscript = script('~', 'subscript', B.subscript);
