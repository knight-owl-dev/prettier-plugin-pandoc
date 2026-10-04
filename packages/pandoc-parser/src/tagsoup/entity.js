// Character references as TagSoup resolves them: HTML5's named references,
// and the numeric ones.
//
// Ported from TagSoup 0.14.8's `Text.HTML.TagSoup.Entity`. Its table is
// commonmark's, already ported, and these names besides, which HTML5 lets
// stand without their `;`.

import { NAMED_REFERENCES } from '../entities-table.js';

// cspell:disable
const LEGACY = new Set([
  'AElig',
  'AMP',
  'Aacute',
  'Acirc',
  'Agrave',
  'Aring',
  'Atilde',
  'Auml',
  'COPY',
  'Ccedil',
  'ETH',
  'Eacute',
  'Ecirc',
  'Egrave',
  'Euml',
  'GT',
  'Iacute',
  'Icirc',
  'Igrave',
  'Iuml',
  'LT',
  'Ntilde',
  'Oacute',
  'Ocirc',
  'Ograve',
  'Oslash',
  'Otilde',
  'Ouml',
  'QUOT',
  'REG',
  'THORN',
  'Uacute',
  'Ucirc',
  'Ugrave',
  'Uuml',
  'Yacute',
  'aacute',
  'acirc',
  'acute',
  'aelig',
  'agrave',
  'amp',
  'aring',
  'atilde',
  'auml',
  'brvbar',
  'ccedil',
  'cedil',
  'cent',
  'copy',
  'curren',
  'deg',
  'divide',
  'eacute',
  'ecirc',
  'egrave',
  'eth',
  'euml',
  'frac12',
  'frac14',
  'frac34',
  'gt',
  'iacute',
  'icirc',
  'iexcl',
  'igrave',
  'iquest',
  'iuml',
  'laquo',
  'lt',
  'macr',
  'micro',
  'middot',
  'nbsp',
  'not',
  'ntilde',
  'oacute',
  'ocirc',
  'ograve',
  'ordf',
  'ordm',
  'oslash',
  'otilde',
  'ouml',
  'para',
  'plusmn',
  'pound',
  'quot',
  'raquo',
  'reg',
  'sect',
  'shy',
  'sup1',
  'sup2',
  'sup3',
  'szlig',
  'thorn',
  'times',
  'uacute',
  'ucirc',
  'ugrave',
  'uml',
  'uuml',
  'yacute',
  'yen',
  'yuml',
]);
// cspell:enable

/**
 * What a named reference stands for, `;` included where it had one.
 *
 * @see Text.HTML.TagSoup.Entity.lookupNamedEntity
 * @param {string} name
 * @returns {string | undefined}
 */
export function lookupNamedEntity(name) {
  if (name.endsWith(';')) return NAMED_REFERENCES.get(name);
  return LEGACY.has(name) ? NAMED_REFERENCES.get(`${name};`) : undefined;
}

/**
 * What a numeric reference stands for, its `#` dropped: decimal digits, or
 * `x` and hex digits; none past Unicode's code points.
 *
 * @see Text.HTML.TagSoup.Entity.lookupNumericEntity
 * @param {string} body
 * @returns {string | undefined}
 */
export function lookupNumericEntity(body) {
  const hex = body[0] === 'x' || body[0] === 'X';
  const digits = hex ? body.slice(1) : body;
  if (!(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) return undefined;
  const code = BigInt(hex ? `0x${digits}` : digits);
  return code <= 0x10ffffn ? codePointText(Number(code)) : undefined;
}

/**
 * What a reference stands for: `#` and a number, or a name.
 *
 * @see Text.HTML.TagSoup.Entity.lookupEntity
 * @param {string} body
 */
export const lookupEntity = (body) =>
  body[0] === '#'
    ? lookupNumericEntity(body.slice(1))
    : lookupNamedEntity(body);

/**
 * A code point as text: a surrogate, which Haskell's `Text` cannot hold,
 * U+FFFD, as Pandoc's `T.pack` makes it.
 *
 * @param {number} code
 */
export const codePointText = (code) =>
  code >= 0xd800 && code <= 0xdfff ? '�' : String.fromCodePoint(code);
