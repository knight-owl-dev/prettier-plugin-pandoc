// Character references resolved as Pandoc 3.11 resolves them, through
// commonmark's `Commonmark.Entity.lookupEntity`.

import { NAMED_REFERENCES } from './entities-table.js';

// `#` and decimal digits, or `#x` and hex digits, which Haskell's
// `hexadecimal` lets a `0x` prefix.
// U+FFFD, the replacement character.
const REPLACEMENT = String.fromCodePoint(0xfffd);

const NUMERIC = /^#(?:([0-9]+)|[xX](?:0[xX])?([0-9a-fA-F]+));?$/;

/**
 * The text a character reference's body stands for: `amp;` for a named one,
 * `#38;` or `#x26;` for a numeric one; undefined for none. A numeric one of
 * 0, past Unicode's code points, or at a surrogate stands for U+FFFD, as
 * Haskell's `Text` cannot hold a surrogate.
 *
 * @see Commonmark.Entity.lookupEntity
 * @param {string} body
 * @returns {string | undefined}
 */
export function lookupEntity(body) {
  if (body[0] !== '#') return NAMED_REFERENCES.get(body);
  const [, decimal, hex] = NUMERIC.exec(body) ?? [];
  if (decimal === undefined && hex === undefined) return undefined;
  const code =
    decimal === undefined ? Number.parseInt(hex, 16) : Number(decimal);
  const valid =
    code >= 1 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return valid ? String.fromCodePoint(code) : REPLACEMENT;
}

/**
 * `text` with each character reference in it resolved, a reference's `;`
 * optional; one that resolves to nothing kept.
 *
 * @see Text.Pandoc.XML.fromEntities
 * @param {string} text
 */
export function fromEntities(text) {
  let out = '';
  let rest = text;
  for (let amp = rest.indexOf('&'); amp !== -1; amp = rest.indexOf('&')) {
    out += rest.slice(0, amp);
    const tail = rest.slice(amp);
    const end = tail.search(/[\s;]/u);
    const ent = end === -1 ? tail : tail.slice(0, end);
    const after = end === -1 ? '' : tail.slice(end);
    const resolved = lookupEntity(`${ent.slice(1)};`);
    if (resolved === undefined) {
      out += ent;
      rest = after;
    } else {
      out += resolved;
      rest = after.startsWith(';') ? after.slice(1) : after;
    }
  }
  return out + rest;
}
