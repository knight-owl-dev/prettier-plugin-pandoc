// URIs as Pandoc writes and recognizes them.
//
// Ported from Pandoc 3.11's `Text.Pandoc.URI`.

import { isSpace } from './char.js';

const UNSAFE = new Set('<>|"{}[]^`');
const encoder = new TextEncoder();

/**
 * `text` with each space and each of `<>|"{}[]^`` percent-encoded, a byte
 * of its UTF-8 at a time, as Network.URI's `escapeURIString` writes them.
 *
 * @see Text.Pandoc.URI.escapeURI
 * @param {string} text
 */
export function escapeURI(text) {
  let out = '';
  for (const c of text) {
    if (!isSpace(c) && !UNSAFE.has(c)) {
      out += c;
      continue;
    }
    for (const byte of encoder.encode(c)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

const isAlphaNum = (c) => /^[A-Za-z0-9]$/.test(c);
const isNameChar = (c) => isAlphaNum(c) || '!#$&^_.+-'.includes(c);
const isBase64Char = (c) => isAlphaNum(c) || '/+ \t\r\n'.includes(c);
const isHexDigit = (c) => /^[0-9A-Fa-f]$/.test(c);
// Data.Char's isSpace, whose spaces attoparsec's `skipWhile isSpace` skips.
const isMediaSpace = (c) => c !== undefined && isSpace(c);

/**
 * Where a base64 data URI at `from` ends, or -1 for none: `data:`, a
 * media type and its parameters, `;base64,`, then the data. Where the scan
 * reaches the text's end, attoparsec's `parse` asks for more input, which
 * Pandoc takes for no match: -1 then too.
 *
 * @see Text.Pandoc.URI.pBase64DataURI
 * @param {string} text
 * @param {number} from
 */
export function base64DataURIEnd(text, from) {
  let at = from;
  let partial = false;
  const peek = () => {
    if (at >= text.length) partial = true;
    return text[at];
  };
  const literal = (s) => {
    for (const c of s) {
      if (peek() !== c) return false;
      at++;
    }
    return true;
  };
  const name = () => {
    if (!isAlphaNum(peek() ?? '')) return false;
    at++;
    while (isNameChar(peek() ?? '')) at++;
    return true;
  };
  // A media type parameter, `;` then `name=value`; on failure, at its start.
  const param = () => {
    const start = at;
    if (peek() !== ';') return false;
    at++;
    while (isMediaSpace(peek())) at++;
    if (name() && peek() === '=') {
      at++;
      while (peek() !== undefined && text[at] !== ';') at++;
      return true;
    }
    at = start;
    return false;
  };
  // `%` and two hex digits; on failure, at the `%`.
  const percentOctet = () => {
    const start = at;
    if (peek() !== '%') return false;
    at++;
    for (let k = 0; k < 2; k++) {
      if (!isHexDigit(peek() ?? '')) {
        at = start;
        return false;
      }
      at++;
    }
    return true;
  };
  const data = () => {
    for (;;) {
      if (isBase64Char(peek() ?? '')) {
        while (isBase64Char(peek() ?? '')) at++;
      } else if (!percentOctet()) {
        return;
      }
    }
  };
  const matched =
    literal('data:') &&
    name() &&
    literal('/') &&
    name() &&
    (() => {
      while (param());
      return literal(';base64,');
    })();
  if (!matched) return -1;
  data();
  while (peek() === '=') at++;
  return partial ? -1 : at;
}
