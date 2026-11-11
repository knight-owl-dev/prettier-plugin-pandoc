// LaTeX3's expandable evaluators: `\inteval`'s integer expressions and a
// practical subset of `\fpeval`'s floating point ones.
//
// Ported from Pandoc's `Text.Pandoc.Readers.LaTeX.Parsing`.

import { isAlpha as isLetter } from '../data-char.js';

const isDigit = (c) => c >= '0' && c <= '9';

// A parse of `s` from `i`: a value and where it ends, or null.
const skipWs = (s, i) => {
  while (i < s.length && ' \t\n\r'.includes(s[i])) i++;
  return i;
};

/**
 * An integer expression's value: `+ - * / ( )`, division rounding to the
 * nearest, ties away from zero, as eTeX's `\numexpr`; null where it will
 * not evaluate.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.evalInteval
 * @param {string} t
 * @returns {string | null}
 */
export function evalInteval(t) {
  const expr = (i) => {
    let r = term(i);
    for (;;) {
      if (r === null) return null;
      const j = skipWs(t, r[1]);
      if (t[j] !== '+' && t[j] !== '-') return r;
      const y = term(j + 1);
      if (y === null) return null;
      r = [t[j] === '+' ? r[0] + y[0] : r[0] - y[0], y[1]];
    }
  };
  const term = (i) => {
    let r = factor(i);
    for (;;) {
      if (r === null) return null;
      const j = skipWs(t, r[1]);
      if (t[j] !== '*' && t[j] !== '/') return r;
      const y = factor(j + 1);
      if (y === null || (t[j] === '/' && y[0] === 0n)) return null;
      r = [t[j] === '*' ? r[0] * y[0] : divRound(r[0], y[0]), y[1]];
    }
  };
  const factor = (i0) => {
    const i = skipWs(t, i0);
    const c = t[i];
    if (c === '-' || c === '+') {
      const r = factor(i + 1);
      return r === null || c === '+' ? r : [-r[0], r[1]];
    }
    if (c === '(') {
      const r = expr(i + 1);
      if (r === null) return null;
      const j = skipWs(t, r[1]);
      return t[j] === ')' ? [r[0], j + 1] : null;
    }
    let j = i;
    while (j < t.length && isDigit(t[j])) j++;
    return j === i ? null : [BigInt(t.slice(i, j)), j];
  };
  const r = expr(0);
  if (r === null || skipWs(t, r[1]) !== t.length) return null;
  return r[0].toString();
}

// Haskell's `quotRem`, rounded to the nearest, ties away from zero.
function divRound(a, b) {
  const [q, r] = [a / b, a % b];
  const abs = (x) => (x < 0n ? -x : x);
  const sign = (x) => (x < 0n ? -1n : x > 0n ? 1n : 0n);
  return 2n * abs(r) >= abs(b) ? q + sign(a) * sign(b) : q;
}

const rad = (x) => (x * Math.PI) / 180;
const unrad = (x) => (x * 180) / Math.PI;
const recip = (x) => 1 / x;

const UNARY = new Map([
  ['abs', Math.abs],
  ['sign', Math.sign],
  ['sqrt', Math.sqrt],
  ['exp', Math.exp],
  ['ln', Math.log],
  ['fact', fact],
  ['sin', Math.sin],
  ['cos', Math.cos],
  ['tan', Math.tan],
  ['cot', (x) => recip(Math.tan(x))],
  ['sec', (x) => recip(Math.cos(x))],
  ['csc', (x) => recip(Math.sin(x))],
  ['asin', Math.asin],
  ['acos', Math.acos],
  ['atan', Math.atan],
  ['acot', (x) => Math.atan(recip(x))],
  ['asec', (x) => Math.acos(recip(x))],
  ['acsc', (x) => Math.asin(recip(x))],
  ['sind', (x) => Math.sin(rad(x))],
  ['cosd', (x) => Math.cos(rad(x))],
  ['tand', (x) => Math.tan(rad(x))],
  ['cotd', (x) => recip(Math.tan(rad(x)))],
  ['secd', (x) => recip(Math.cos(rad(x)))],
  ['cscd', (x) => recip(Math.sin(rad(x)))],
  ['asind', (x) => unrad(Math.asin(x))],
  ['acosd', (x) => unrad(Math.acos(x))],
  ['atand', (x) => unrad(Math.atan(x))],
  ['acotd', (x) => unrad(Math.atan(recip(x)))],
  ['asecd', (x) => unrad(Math.acos(recip(x)))],
  ['acscd', (x) => unrad(Math.asin(recip(x)))],
]);

// n! as a double, for n a whole number below 171; NaN else.
function fact(x) {
  if (!(x >= 0 && x === roundHalfEven(x) && x < 171)) return Number.NaN;
  let p = 1n;
  for (let k = 2n; k <= BigInt(x); k++) p *= k;
  return Number(p);
}

// Haskell's `round`: ties to even.
function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

// Haskell's `max` and `min` on doubles.
// biome-ignore lint/complexity/useMathMinMax: a NaN, unlike Math.max's
const max = (x, y) => (x <= y ? y : x);
// biome-ignore lint/complexity/useMathMinMax: a NaN, unlike Math.min's
const min = (x, y) => (x <= y ? x : y);

const ROUNDERS = new Map([
  ['round', roundHalfEven],
  ['floor', Math.floor],
  ['ceil', Math.ceil],
  ['trunc', Math.trunc],
]);

// A function applied to its arguments; null where it is none of these.
function applyFn(name, args) {
  const f = UNARY.get(name);
  if (f !== undefined && args.length === 1) return f(args[0]);
  if ((name === 'max' || name === 'min') && args.length > 0) {
    return args.reduce(name === 'max' ? max : min);
  }
  if (name === 'atan' && args.length === 2) return Math.atan2(...args);
  if (name === 'atand' && args.length === 2) return unrad(Math.atan2(...args));
  const r = ROUNDERS.get(name);
  return r === undefined ? null : rounder(r, args);
}

/**
 * A rounding function, to a number of decimal places where a second
 * argument gives one: rounded to 16 significant digits first, as l3fp, so
 * that `round(2.345,2)` is 2.34.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.evalFpeval
 */
function rounder(f, args) {
  if (args.length === 1) return f(args[0]);
  if (args.length !== 2) return null;
  const [x, n] = args;
  if (n !== roundHalfEven(n)) return null;
  const m = n >= 0 ? 10 ** n : 1 / 10 ** -n;
  return f(round16(x * m)) / m;
}

/**
 * A floating point expression's value: `+ - * / ^ ( )`, `**` for `^`,
 * decimal literals, `pi`, `deg` and functions, as a subset of `\fpeval`;
 * null where it will not evaluate.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.evalFpeval
 * @param {string} t0
 * @returns {string | null}
 */
export function evalFpeval(t0) {
  const t = t0.replaceAll('**', '^');
  const charAt = (i) =>
    i < t.length ? String.fromCodePoint(t.codePointAt(i)) : '';
  const expr = (i) => {
    let r = term(i);
    for (;;) {
      if (r === null) return null;
      const j = skipWs(t, r[1]);
      if (t[j] !== '+' && t[j] !== '-') return r;
      const y = term(j + 1);
      if (y === null) return null;
      r = [t[j] === '+' ? r[0] + y[0] : r[0] - y[0], y[1]];
    }
  };
  const term = (i) => {
    let r = pow(i);
    for (;;) {
      if (r === null) return null;
      const j = skipWs(t, r[1]);
      if (t[j] !== '*' && t[j] !== '/') return r;
      const y = pow(j + 1);
      if (y === null) return null;
      r = [t[j] === '*' ? r[0] * y[0] : r[0] / y[0], y[1]];
    }
  };
  // Right-associative.
  const pow = (i) => {
    const r = factor(i);
    if (r === null) return null;
    const j = skipWs(t, r[1]);
    if (t[j] !== '^') return r;
    const y = pow(j + 1);
    return y === null ? null : [r[0] ** y[0], y[1]];
  };
  const factor = (i0) => {
    const i = skipWs(t, i0);
    const c = charAt(i);
    if (c === '-' || c === '+') {
      const r = factor(i + 1);
      return r === null || c === '+' ? r : [-r[0], r[1]];
    }
    if (c === '(') {
      const r = expr(i + 1);
      if (r === null) return null;
      const j = skipWs(t, r[1]);
      return t[j] === ')' ? [r[0], j + 1] : null;
    }
    if (c !== '' && isLetter(c)) {
      let j = i;
      while (j < t.length && isLetter(charAt(j))) j += charAt(j).length;
      const name = t.slice(i, j);
      if (name === 'pi') return [Math.PI, j];
      if (name === 'deg') return [Math.PI / 180, j]; // a degree in radians
      const k = skipWs(t, j);
      if (t[k] === '(') {
        const a = fnArgs(k + 1);
        if (a === null) return null;
        const x = applyFn(name, a[0]);
        return x === null ? null : [x, a[1]];
      }
      // A prefix application, without parentheses: `sqrt 2`.
      const y = factor(j);
      if (y === null) return null;
      const x = applyFn(name, [y[0]]);
      return x === null ? null : [x, y[1]];
    }
    if (isDigit(c) || c === '.') return literal(i);
    return null;
  };
  const literal = (i) => {
    let j = i;
    while (j < t.length && (isDigit(t[j]) || t[j] === '.')) j++;
    let ds = t.slice(i, j);
    let expt = '';
    if (t[j] === 'e' || t[j] === 'E') {
      let k = j + 1;
      const sign = t[k] === '+' || t[k] === '-' ? t[k++] : '';
      const from = k;
      while (k < t.length && isDigit(t[k])) k++;
      if (k > from) [expt, j] = [`e${sign}${t.slice(from, k)}`, k];
    }
    // As Haskell's `read` takes it.
    if (ds.startsWith('.')) ds = `0${ds}`;
    if (ds.endsWith('.')) ds = `${ds}0`;
    if (!/^\d+(\.\d+)?$/.test(ds)) return null;
    return [Number(ds + expt), j];
  };
  // Comma-separated arguments to `)`.
  const fnArgs = (i) => {
    const xs = [];
    for (let j = i; ; ) {
      const r = expr(j);
      if (r === null) return null;
      xs.push(r[0]);
      const k = skipWs(t, r[1]);
      if (t[k] === ')') return [xs, k + 1];
      if (t[k] !== ',') return null;
      j = k + 1;
    }
  };
  const r = expr(0);
  if (r === null || skipWs(t, r[1]) !== t.length) return null;
  if (!Number.isFinite(r[0])) return null;
  return formatFp(r[0]);
}

/**
 * A double rounded to 16 significant digits, as Haskell reads back its
 * `showEFloat (Just 15)`: the shortest digits rounded, half to even only
 * where exactly half.
 *
 * @param {number} x
 */
function round16(x) {
  if (x === 0 || !Number.isFinite(x)) return x;
  const [mantissa, e] = Math.abs(x).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  if (digits.length <= 16) return x;
  const ds = [...digits.slice(0, 16)].map(Number);
  const last = Number(digits[16]);
  // GHC's `roundTo`: up from 5, but to even at exactly 5.
  let carry = last > 5 || (last === 5 && ds[15] % 2 === 1) ? 1 : 0;
  for (let k = 15; k >= 0 && carry; k--) {
    ds[k] += carry;
    carry = ds[k] === 10 ? 1 : 0;
    if (carry) ds[k] = 0;
  }
  const exp = Number(e) + carry;
  const all = carry ? [1, ...ds.slice(0, 15)] : ds;
  return Math.sign(x) * Number(`${all[0]}.${all.slice(1).join('')}e${exp}`);
}

/**
 * A result as `\fpeval` writes it: rounded to 16 significant digits, as
 * l3fp computes, so 0.1 + 0.2 is 0.3; a whole number without a point.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.formatFp
 * @param {number} x0
 */
export function formatFp(x0) {
  const x = round16(x0);
  const r = roundHalfEven(x);
  if (x === r && Math.abs(x) < 1e16) return BigInt(r).toString();
  return trimZeros(showFFloat(x));
}

// Haskell's `showFFloat Nothing`: the shortest digits, in full.
function showFFloat(x) {
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  const [mantissa, e] = Math.abs(x).toExponential().split('e');
  const ds = mantissa.replace('.', '');
  const exp = Number(e) + 1; // digits before the point
  if (exp <= 0) return `${sign}0.${'0'.repeat(-exp)}${ds}`;
  const int = ds.slice(0, exp).padEnd(exp, '0');
  const frac = ds.slice(exp);
  return `${sign}${int}.${frac === '' ? '0' : frac}`;
}

const trimZeros = (s) =>
  s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
