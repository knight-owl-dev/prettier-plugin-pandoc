// Attributes in braces, `{#id .class key=value -}`, and the raw attribute
// `{=format}`.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`.

import {
  alphaNum,
  char,
  isAlphaNum,
  isSpace,
  letter,
  noneOf,
  oneOf,
  satisfy,
  string,
} from '../char.js';
import { alt, attempt, FAIL, many, many1 } from '../core.js';
import { enclosed, skipSpaces, textOf } from '../parsing/general.js';
import { escapedCharacter, litChar, spnl } from './common.js';

/** @typedef {[string, string[], [string, string][]]} Attr */

const idChar = alt(alphaNum, oneOf('-_:.'));
const idChars = many(idChar);

/**
 * A letter, then letters, digits and `-_:.`.
 *
 * @see Text.Pandoc.Readers.Markdown.identifier
 */
export const identifier = textOf((ctx) =>
  letter(ctx) === FAIL ? FAIL : idChars(ctx),
);

const hash = char('#');
const idValue = textOf(many1(idChar));
const dot = char('.');
const equals = char('=');

// Each attribute parser returns how it changes the attributes so far.

const identifierAttr = attempt((ctx) => {
  const id = hash(ctx) === FAIL ? FAIL : idValue(ctx);
  if (id === FAIL) return FAIL;
  return ([, classes, pairs]) => [id, classes, pairs];
});

const classAttr = attempt((ctx) => {
  if (dot(ctx) === FAIL) return FAIL;
  const name = identifier(ctx);
  if (name === FAIL) return FAIL;
  return ([id, classes, pairs]) => [id, [...classes, name], pairs];
});

// The values `p` returns, joined: escapes and references decoded, unlike
// `textOf`, which slices the source.
const asText = (p) => (ctx) => {
  const xs = p(ctx);
  return xs === FAIL ? FAIL : xs.join('');
};

// `quotes`, empty between them, as no text.
const emptyQuotes = (quotes) => {
  const p = attempt(string(quotes));
  return (ctx) => (p(ctx) === FAIL ? FAIL : '');
};

const quotedBy = (q) => asText(enclosed(char(q), char(q), litChar));
const value = alt(
  quotedBy('"'),
  quotedBy("'"),
  emptyQuotes('""'),
  emptyQuotes("''"),
  asText(many(alt(escapedCharacter, noneOf(' \t\n\r}')))),
);

// Haskell's `words`: the runs between its spaces.
function words(s) {
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

const keyValAttr = attempt((ctx) => {
  const key = identifier(ctx);
  if (key === FAIL || equals(ctx) === FAIL) return FAIL;
  const val = value(ctx);
  if (val === FAIL) return FAIL;
  if (key === 'id') return ([, classes, pairs]) => [val, classes, pairs];
  if (key === 'class') {
    return ([id, classes, pairs]) => [id, [...classes, ...words(val)], pairs];
  }
  return ([id, classes, pairs]) => [id, classes, [...pairs, [key, val]]];
});

const hyphen = char('-');
const specialAttr = (ctx) =>
  hyphen(ctx) === FAIL
    ? FAIL
    : ([id, classes, pairs]) => [id, [...classes, 'unnumbered'], pairs];

const attribute = alt(identifierAttr, classAttr, keyValAttr, specialAttr);
const attributeList = many((ctx) => {
  const change = attribute(ctx);
  return change === FAIL || spnl(ctx) === FAIL ? FAIL : change;
});
const open = char('{');
const close = char('}');

/**
 * Attributes in braces, applied in order to empty ones.
 *
 * @see Text.Pandoc.Readers.Markdown.attributes
 * @type {import('../core.js').Parser<Attr>}
 */
export const attributes = attempt((ctx) => {
  if (open(ctx) === FAIL || spnl(ctx) === FAIL) return FAIL;
  const changes = attributeList(ctx);
  if (changes === FAIL || close(ctx) === FAIL) return FAIL;
  return changes.reduce((attr, change) => change(attr), ['', [], []]);
});

const formatChar = satisfy((c) => isAlphaNum(c) || c === '-' || c === '_');
const formatChars = textOf(many1(formatChar));

/**
 * A raw attribute, `{=format}`: the format.
 *
 * @see Text.Pandoc.Readers.Markdown.rawAttribute
 * @type {import('../core.js').Parser<string>}
 */
export function rawAttribute(ctx) {
  if (open(ctx) === FAIL) return FAIL;
  skipSpaces(ctx);
  if (equals(ctx) === FAIL) return FAIL;
  const format = formatChars(ctx);
  if (format === FAIL) return FAIL;
  skipSpaces(ctx);
  return close(ctx) === FAIL ? FAIL : format;
}
