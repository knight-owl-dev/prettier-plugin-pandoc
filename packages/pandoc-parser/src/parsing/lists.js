// Ordered list markers: a number of some style, and its delimiter.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Parsing.Lists`. A marker parser
// returns its list attributes, `[start, style, delimiter]`, as Pandoc's
// JSON writes them.

import {
  Decimal,
  DefaultDelim,
  DefaultStyle,
  Example,
  LowerAlpha,
  LowerRoman,
  OneParen,
  Period,
  TwoParens,
  UpperAlpha,
  UpperRoman,
} from '../ast/nodes.js';
import { alphaNum, char, digit } from '../char.js';
import { alt, attempt, choice, FAIL, skipMany, skipMany1 } from '../core.js';
import { textOf } from './general.js';
import { updateState } from './state.js';

/** @typedef {import('../core.js').Context} Context */
/** @typedef {[number, {t: string}, {t: string}]} ListAttributes */

const ROMAN = {
  upper: { M: 'M', D: 'D', C: 'C', L: 'L', X: 'X', V: 'V', I: 'I' },
  lower: { M: 'm', D: 'd', C: 'c', L: 'l', X: 'x', V: 'v', I: 'i' },
};

// How many of `c` start at the position, read.
function run(ctx, c) {
  let n = 0;
  while (ctx.text[ctx.pos] === c) {
    ctx.pos++;
    n++;
  }
  return n;
}

// `value` where `pair` starts at the position, read; else 0, nothing read.
function pairOf(ctx, pair, value) {
  if (!ctx.text.startsWith(pair, ctx.pos)) return 0;
  ctx.pos += 2;
  return value;
}

// `value` where `c` is at the position, read; else 0, nothing read.
function oneOf(ctx, c, value) {
  if (ctx.text[ctx.pos] !== c) return 0;
  ctx.pos++;
  return value;
}

/**
 * A roman numeral of one case: its value, or `FAIL` with nothing read.
 *
 * @see Text.Pandoc.Parsing.Lists.romanNumeral
 * @param {Context} ctx
 * @param {boolean} upper
 * @returns {number | typeof FAIL}
 */
function romanNumeral(ctx, upper) {
  const { M, D, C, L, X, V, I } = upper ? ROMAN.upper : ROMAN.lower;
  if (![M, D, C, L, X, V, I].includes(ctx.text[ctx.pos])) return FAIL;
  const total =
    1000 * run(ctx, M) +
    pairOf(ctx, C + M, 900) +
    oneOf(ctx, D, 500) +
    pairOf(ctx, C + D, 400) +
    100 * run(ctx, C) +
    pairOf(ctx, X + C, 90) +
    oneOf(ctx, L, 50) +
    pairOf(ctx, X + L, 40) +
    10 * run(ctx, X) +
    pairOf(ctx, I + X, 9) +
    oneOf(ctx, V, 5) +
    pairOf(ctx, I + V, 4) +
    run(ctx, I);
  return total === 0 ? FAIL : total;
}

/**
 * Digits as Haskell reads an `Int`: wrapped at 64 bits, as `safeRead` does.
 * Past 2^53 the number is JSON's nearest.
 *
 * @param {string} digits
 */
export const readInt = (digits) => Number(BigInt.asIntN(64, BigInt(digits)));

// A number parser's result: its style and value.
const styled = (style, value) => [style, value];

const digits = textOf(skipMany1(digit));

/** @see Text.Pandoc.Parsing.Lists.decimal */
function decimal(ctx) {
  const n = digits(ctx);
  return n === FAIL ? FAIL : styled(Decimal, readInt(n));
}

/** @see Text.Pandoc.Parsing.Lists.upperRoman */
function upperRoman(ctx) {
  const n = romanNumeral(ctx, true);
  return n === FAIL ? FAIL : styled(UpperRoman, n);
}

/** @see Text.Pandoc.Parsing.Lists.lowerRoman */
function lowerRoman(ctx) {
  const n = romanNumeral(ctx, false);
  return n === FAIL ? FAIL : styled(LowerRoman, n);
}

// An ASCII letter between `from` and `to`, and its place from 1.
const letterIn = (from, to, style) => (ctx) => {
  const c = ctx.text[ctx.pos];
  if (c === undefined || c < from || c > to) return FAIL;
  ctx.pos++;
  return styled(style, c.charCodeAt(0) - from.charCodeAt(0) + 1);
};

/** @see Text.Pandoc.Parsing.Lists.lowerAlpha */
const lowerAlpha = letterIn('a', 'z', LowerAlpha);

/** @see Text.Pandoc.Parsing.Lists.upperAlpha */
const upperAlpha = letterIn('A', 'Z', UpperAlpha);

/** @see Text.Pandoc.Parsing.Lists.romanOne */
function romanOne(ctx) {
  const c = ctx.text[ctx.pos];
  if (c !== 'i' && c !== 'I') return FAIL;
  ctx.pos++;
  return styled(c === 'i' ? LowerRoman : UpperRoman, 1);
}

const hash = char('#');

/** @see Text.Pandoc.Parsing.Lists.defaultNum */
const defaultNum = (ctx) =>
  hash(ctx) === FAIL ? FAIL : styled(DefaultStyle, 1);

const at = char('@');
const labelPart = alt(
  skipMany1(alphaNum),
  attempt((ctx) => {
    const c = ctx.text[ctx.pos];
    if (c !== '_' && c !== '-') return FAIL;
    ctx.pos++;
    return skipMany1(alphaNum)(ctx);
  }),
);
const label = textOf(skipMany(labelPart));
const count = textOf(skipMany(digit));

/**
 * `@`, a count before it and a label after it either optional: the next
 * example's number, a label's own where it has one already.
 *
 * @see Text.Pandoc.Parsing.Lists.exampleNum
 */
function exampleNum(ctx) {
  const counted = count(ctx);
  if (at(ctx) === FAIL) return FAIL;
  const name = label(ctx);
  if (counted !== '') updateState(ctx, { nextExample: readInt(counted) });
  const { examples, nextExample } = ctx.state;
  const known = examples.get(name);
  if (known !== undefined) return styled(Example, known);
  updateState(ctx, {
    nextExample: nextExample + 1,
    examples: name === '' ? examples : examples.set(name, nextExample),
  });
  return styled(Example, nextExample);
}

const period = char('.');
const close = char(')');
const open = char('(');

// The number `num` reads, then a period: list attributes.
// @see Text.Pandoc.Parsing.Lists.inPeriod
const inPeriod = (num) =>
  attempt((ctx) => {
    const n = num(ctx);
    if (n === FAIL || period(ctx) === FAIL) return FAIL;
    const [style, start] = n;
    return [start, style, style === DefaultStyle ? DefaultDelim : Period];
  });

// The number `num` reads, then a parenthesis.
// @see Text.Pandoc.Parsing.Lists.inOneParen
const inOneParen = (num) =>
  attempt((ctx) => {
    const n = num(ctx);
    if (n === FAIL || close(ctx) === FAIL) return FAIL;
    return [n[1], n[0], OneParen];
  });

// The number `num` reads, in parentheses.
// @see Text.Pandoc.Parsing.Lists.inTwoParens
const inTwoParens = (num) =>
  attempt((ctx) => {
    if (open(ctx) === FAIL) return FAIL;
    const n = num(ctx);
    if (n === FAIL || close(ctx) === FAIL) return FAIL;
    return [n[1], n[0], TwoParens];
  });

const NUMBERS = [
  decimal,
  exampleNum,
  defaultNum,
  romanOne,
  lowerAlpha,
  lowerRoman,
  upperAlpha,
  upperRoman,
];

/**
 * Any ordered list marker: each delimiter, each style within it, in
 * Pandoc's order.
 *
 * @see Text.Pandoc.Parsing.Lists.anyOrderedListMarker
 * @type {import('../core.js').Parser<ListAttributes>}
 */
export const anyOrderedListMarker = choice(
  [inPeriod, inOneParen, inTwoParens].flatMap((delimited) =>
    NUMBERS.map(delimited),
  ),
);

const NUMBER_OF = new Map([
  ['DefaultStyle', decimal],
  ['Example', exampleNum],
  ['Decimal', decimal],
  ['UpperRoman', upperRoman],
  ['LowerRoman', lowerRoman],
  ['UpperAlpha', upperAlpha],
  ['LowerAlpha', lowerAlpha],
]);
const DELIMITED_BY = new Map([
  ['DefaultDelim', inPeriod],
  ['Period', inPeriod],
  ['OneParen', inOneParen],
  ['TwoParens', inTwoParens],
]);
const markers = new Map();

/**
 * A marker of `style` and `delim`, `#` standing for any number: the
 * number it reads.
 *
 * @see Text.Pandoc.Parsing.Lists.orderedListMarker
 * @param {{t: string}} style
 * @param {{t: string}} delim
 * @returns {import('../core.js').Parser<number>}
 */
export function orderedListMarker(style, delim) {
  const key = `${style.t} ${delim.t}`;
  let marker = markers.get(key);
  if (marker === undefined) {
    const num = alt(defaultNum, NUMBER_OF.get(style.t));
    const delimited = DELIMITED_BY.get(delim.t)(num);
    marker = (ctx) => {
      const attrs = delimited(ctx);
      return attrs === FAIL ? FAIL : attrs[0];
    };
    markers.set(key, marker);
  }
  return marker;
}
