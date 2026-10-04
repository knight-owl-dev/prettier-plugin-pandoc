// A citation's key: `@` and an identifier, or one in braces.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.Citations`.

import { char, isAlphaNum, isSpace, oneOf, satisfy } from '../char.js';
import { alt, attempt, FAIL, lookAhead, many } from '../core.js';
import { charsInBalanced } from './general.js';
import { notAfterString } from './state.js';

/** @typedef {import('../core.js').Context} Context */

const isRegChar = (c) => isAlphaNum(c) || c === '_';
const regChar = satisfy(isRegChar);
const regCharAhead = lookAhead(regChar);
const slashAhead = lookAhead(char('/'));

// A punctuation character inside an identifier: before another word
// character, or `:` and `/` before a `/`.
const internal = (p, ahead) =>
  attempt((ctx) => {
    const c = p(ctx);
    return c === FAIL || ahead(ctx) === FAIL ? FAIL : c;
  });

const firstChar = satisfy((c) => isRegChar(c) || c === '*');
const restChars = many(
  alt(
    regChar,
    internal(oneOf(':.#$%&-+?<>~/'), regCharAhead),
    internal(oneOf(':/'), slashAhead),
  ),
);

/**
 * A key's identifier: a letter, digit, `_` or `*`, then letters, digits
 * and `_`, punctuation between them.
 *
 * @see Text.Pandoc.Parsing.Citations.simpleCiteIdentifier
 * @param {Context} ctx
 */
function simpleCiteIdentifier(ctx) {
  const first = firstChar(ctx);
  if (first === FAIL) return FAIL;
  const rest = restChars(ctx);
  return rest === FAIL ? FAIL : first + rest.join('');
}

const braced = charsInBalanced(
  '{',
  '}',
  satisfy((c) => !isSpace(c)),
);
const at = char('@');
const dash = char('-');
const identifier = alt(simpleCiteIdentifier, braced);

/**
 * A citation's key, not right after a word: `-` to suppress the author,
 * `@`, then an identifier or text in braces. Whether the author is
 * suppressed, and the key.
 *
 * @see Text.Pandoc.Parsing.Citations.citeKey
 * @type {import('../core.js').Parser<{suppress: boolean, key: string}>}
 */
export const citeKey = attempt((ctx) => {
  if (!notAfterString(ctx)) return FAIL;
  const suppress = dash(ctx) !== FAIL;
  if (at(ctx) === FAIL) return FAIL;
  const key = identifier(ctx);
  return key === FAIL ? FAIL : { suppress, key };
});
