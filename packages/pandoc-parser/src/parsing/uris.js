// URIs and e-mail addresses in text, as autolinks read them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.General`.

import { alphaNum, char, isAlphaNum, isSpace, satisfy } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  many1,
  notFollowedBy,
  option,
} from '../core.js';
import { fromEntities } from '../entities.js';
import { escapeURI } from '../uri.js';
import { SCHEMES } from '../uri-schemes.js';
import { characterReference, textOf } from './general.js';

/** @typedef {import('../core.js').Context} Context */

// Haskell's `toLower` of a character, as `oneOfStringsCI` applies it: one
// code point, where JavaScript's full mapping may give two (`İ`).
const lower = (c) => String.fromCodePoint(c.toLowerCase().codePointAt(0));

/**
 * The longest of `strings` the text starts with, letter case aside, as
 * written; matched a character at a time, each a prefix of one of them.
 *
 * @see Text.Pandoc.Parsing.General.oneOfStringsCI
 * @param {string[]} strings
 * @returns {import('../core.js').Parser<string>}
 */
function oneOfStringsCI(strings) {
  const prefixes = new Set();
  for (const s of strings) {
    for (let i = 1; i <= s.length; i++) prefixes.add(s.slice(0, i));
  }
  const whole = new Set(strings);
  return (ctx) => {
    const from = ctx.pos;
    let matched = -1;
    let key = '';
    for (let at = from; at < ctx.text.length; ) {
      const c = String.fromCodePoint(ctx.text.codePointAt(at));
      key += lower(c);
      if (!prefixes.has(key)) break;
      at += c.length;
      if (whole.has(key)) matched = at;
    }
    if (matched === -1) return FAIL;
    ctx.pos = matched;
    return ctx.text.slice(from, matched);
  };
}

const uriScheme = oneOfStringsCI(SCHEMES);

const WORD_SYMBOLS = new Set('#$%+/@\\_-&=');
const isWordChar = (c) => WORD_SYMBOLS.has(c) || isAlphaNum(c);
const wordChar = satisfy(isWordChar);
const hexDigit = satisfy((c) => /^[0-9A-Fa-f]$/.test(c));
const percentEscaped = attempt((ctx) => {
  const pct = char('%')(ctx);
  if (pct === FAIL) return FAIL;
  const hex = textOf(many1(hexDigit))(ctx);
  return hex === FAIL ? FAIL : pct + hex;
});
const entity = attempt(characterReference);
const commas = textOf(many1(char(',')));
const punctuationChar = satisfy((c) => !isSpace(c) && c !== '<' && c !== '>');
const punctuation = attempt(alt(commas, punctuationChar));
const wordAhead = lookAhead(alt(wordChar, percentEscaped));
const words = textOf(many1(wordChar));

/**
 * A run of a URI: word characters, a percent escape, a character
 * reference, or punctuation before more of them.
 *
 * @see Text.Pandoc.Parsing.General.uri
 */
const uriChunk = alt(
  words,
  percentEscaped,
  entity,
  attempt((ctx) => {
    const p = punctuation(ctx);
    return p === FAIL || wordAhead(ctx) === FAIL ? FAIL : p;
  }),
);

// A run of a URI between `open` and `close`, kept with them.
const uriChunkBetween = (open, close) => {
  const [o, c] = [char(open), char(close)];
  return attempt((ctx) => {
    if (o(ctx) === FAIL) return FAIL;
    const chunk = uriChunk(ctx);
    if (chunk === FAIL || c(ctx) === FAIL) return FAIL;
    return open + chunk + close;
  });
};

const uriChunks = many1(
  alt(
    uriChunkBetween('(', ')'),
    uriChunkBetween('{', '}'),
    uriChunkBetween('[', ']'),
    uriChunk,
  ),
);
const colon = char(':');
const notEmphasisAfter = notFollowedBy(satisfy((c) => '*_]'.includes(c)));
const trailingSlash = option('', char('/'));

/**
 * A URI of a known scheme, no sentence punctuation at its end: as written,
 * its character references resolved, and escaped.
 *
 * @see Text.Pandoc.Parsing.General.uri
 * @type {import('../core.js').Parser<{orig: string, src: string}>}
 */
export const uri = attempt((ctx) => {
  const scheme = uriScheme(ctx);
  if (scheme === FAIL || colon(ctx) === FAIL) return FAIL;
  if (notEmphasisAfter(ctx) === FAIL) return FAIL;
  const chunks = uriChunks(ctx);
  if (chunks === FAIL) return FAIL;
  const slash = trailingSlash(ctx);
  const orig = `${scheme}:${fromEntities(chunks.join('') + slash)}`;
  return { orig, src: escapeURI(orig) };
});

const EMAIL_SYMBOLS = new Set('!"#$%&\'*+-/=?^_{|}~;');
const isEmailChar = (c) => isAlphaNum(c) || EMAIL_SYMBOLS.has(c);
const dot = char('.');
const emailWord = attempt((ctx) => {
  const first = alphaNum(ctx);
  if (first === FAIL) return FAIL;
  const rest = textOf(many(satisfy(isEmailChar)))(ctx);
  return rest === FAIL ? FAIL : first + rest;
});
const hyphen = char('-');
const alphaNumAfter = notFollowedBy(satisfy((c) => !isAlphaNum(c)));
// A hyphen inside a subdomain: before a letter or digit, or at the end.
const innerHyphen = attempt((ctx) =>
  hyphen(ctx) === FAIL || alphaNumAfter(ctx) === FAIL ? FAIL : '-',
);
const subdomain = textOf(many1(alt(alphaNum, innerHyphen)));

/**
 * `p`s separated by `.`, a `.` read only before another `p`.
 *
 * @see Text.Pandoc.Parsing.General.sepBy1'
 * @param {import('../core.js').Parser<string>} p
 */
const dotted = (p) => {
  const more = many(attempt((ctx) => (dot(ctx) === FAIL ? FAIL : p(ctx))));
  return (ctx) => {
    const first = p(ctx);
    if (first === FAIL) return FAIL;
    const rest = more(ctx);
    return rest === FAIL ? FAIL : [first, ...rest].join('.');
  };
};
const mailbox = dotted(emailWord);
const domain = dotted(subdomain);
const at = char('@');

/**
 * An e-mail address: as written, its character references resolved, and
 * as an escaped `mailto:` URI.
 *
 * @see Text.Pandoc.Parsing.General.emailAddress
 * @type {import('../core.js').Parser<{orig: string, src: string}>}
 */
export const emailAddress = attempt((ctx) => {
  const box = mailbox(ctx);
  if (box === FAIL || at(ctx) === FAIL) return FAIL;
  const dom = domain(ctx);
  if (dom === FAIL) return FAIL;
  const orig = fromEntities(`${box}@${dom}`);
  return { orig, src: escapeURI(`mailto:${orig}`) };
});
