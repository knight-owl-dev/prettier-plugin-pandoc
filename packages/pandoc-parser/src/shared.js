// Text and AST utilities Pandoc's readers share, and the `Data.Text`
// functions they call that JS strings lack.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Shared`.

import { isAlpha, isAlphaNum, isSpace } from './char.js';

/** @typedef {import('./ast/nodes.js').Node} Node */

/** A non-breaking space, U+00A0: a formatter writes the escape as the character. */
export const NBSP = String.fromCodePoint(0xa0);

/**
 * `s` lowercased a code point at a time, as Haskell's `T.toLower`: unlike
 * `toLowerCase`, with no regard to context (a final sigma stays `σ`).
 *
 * @see Data.Text.toLower
 * @param {string} s
 */
export const toLower = (s) => [...s].map((c) => c.toLowerCase()).join('');

/**
 * The runs of `s` between its spaces, as GHC's `isSpace` has them.
 *
 * @see Data.Text.words
 * @param {string} s
 * @returns {string[]}
 */
export function words(s) {
  const out = [];
  let word = '';
  for (const c of s) {
    if (!isSpace(c)) word += c;
    else if (word !== '') {
      out.push(word);
      word = '';
    }
  }
  if (word !== '') out.push(word);
  return out;
}

/**
 * `s` without spaces, tabs or line breaks at either end.
 *
 * @see Text.Pandoc.Shared.trim
 * @param {string} s
 */
export const trim = (s) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

/**
 * `s` without line breaks at its end.
 *
 * @see Text.Pandoc.Shared.stripTrailingNewlines
 * @param {string} s
 */
export const stripTrailingNewlines = (s) => s.replace(/\n+$/, '');

// The inlines a node holds, for those that hold any.
const childrenOf = (x) => {
  switch (x.t) {
    case 'Quoted':
    case 'Cite':
    case 'Link':
    case 'Image':
    case 'Span':
      return x.c[1];
    case 'Emph':
    case 'Underline':
    case 'Strong':
    case 'Strikeout':
    case 'Superscript':
    case 'Subscript':
    case 'SmallCaps':
      return x.c;
    default:
      return [];
  }
};

const QUOTES = {
  SingleQuote: ['‘', '’'],
  DoubleQuote: ['“', '”'],
};

// The text of one inline and all it holds.
function textOf(x) {
  switch (x.t) {
    case 'Str':
      return x.c;
    case 'Space':
    case 'SoftBreak':
    case 'LineBreak':
      return ' ';
    case 'Code':
    case 'Math':
      return x.c[1];
    case 'RawInline':
      return x.c[0].toLowerCase() === 'html' && x.c[1].startsWith('<br')
        ? ' '
        : '';
    case 'Quoted': {
      const [open, close] = QUOTES[x.c[0].t];
      return open + stringify(x.c[1]) + close;
    }
    default:
      return stringify(childrenOf(x));
  }
}

/**
 * The text of inlines, formatting left out: a note's contents and a
 * citation's own prefix and suffix too; quotes as curly quotes.
 *
 * @see Text.Pandoc.Shared.stringify
 * @param {Node[]} inlines
 * @returns {string}
 */
export function stringify(inlines) {
  let out = '';
  for (const x of inlines) out += textOf(x);
  return out;
}

const keptPunctuation = (c) => c === '_' || c === '-' || c === '.';

/**
 * Text as an identifier: lowercased, letters, digits, spaces and `_-.`
 * kept, words joined by `-`, from the first letter on.
 *
 * Not ported yet: `gfm_auto_identifiers` and `ascii_identifiers`, both off
 * by default.
 *
 * @see Text.Pandoc.Shared.textToIdentifier
 * @param {string} text
 */
export function textToIdentifier(text) {
  const kept = [...toLower(text)]
    .filter((c) => isSpace(c) || isAlphaNum(c) || keptPunctuation(c))
    .join('');
  const ident = words(kept).join('-');
  const first = [...ident].findIndex(isAlpha);
  return first === -1 ? '' : [...ident].slice(first).join('');
}

/**
 * Inlines as an identifier.
 *
 * @see Text.Pandoc.Shared.inlineListToIdentifier
 * @param {Node[]} inlines
 */
export const inlineListToIdentifier = (inlines) =>
  textToIdentifier(stringify(inlines));

// Past this, Pandoc lets an identifier repeat.
const MOST_NUMBERED = 60000;

/**
 * An identifier for inlines not among `used`: `section` for none, numbered
 * `-1`, `-2`… where taken.
 *
 * @see Text.Pandoc.Shared.uniqueIdent
 * @param {Node[]} inlines
 * @param {{has: (id: string) => boolean}} used
 */
export function uniqueIdent(inlines, used) {
  const base = inlineListToIdentifier(inlines) || 'section';
  if (!used.has(base)) return base;
  for (let n = 1; n <= MOST_NUMBERED; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return base;
}
