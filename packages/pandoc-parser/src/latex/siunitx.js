// siunitx in LaTeX: numbers, units, quantities, lists, ranges and angles.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.SIunitx`. A
// command's output is made from its arguments, reordered and rewritten: it
// spans nothing, where the command starts.

import * as B from '../ast/builder.js';
import { Node } from '../ast/nodes.js';
import { mapSpans } from '../ast/spans.js';
import { walkInlines } from '../ast/walk.js';
import { char, satisfy, string } from '../char.js';
import {
  alt,
  attempt,
  FAIL,
  many,
  many1,
  option,
  parse,
  skipMany,
  skipMany1,
} from '../core.js';
import { NBSP } from '../shared.js';
import {
  anyControlSeq,
  braced,
  bracketed,
  controlSeq,
  grouped,
  isWordTok,
  keyvals,
  satisfyTok,
  skipopts,
  spaces1,
  symbol,
  untokenize,
} from './parsing.js';

/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */
/** @typedef {(ctx: object, start: number) => Inlines | typeof FAIL} Command */

const MINUS = String.fromCodePoint(0x2212);
const PLUS_MINUS = `${NBSP}±${NBSP}`;
const TIMES = `${NBSP}×${NBSP}`;
const str = (t) => B.str(t);

/**
 * siunitx's commands, reading units by `tok`.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.siunitxCommands
 * @param {Parser<Inlines>} tok
 * @returns {Map<string, Command>}
 */
export function siunitxCommands(tok) {
  // Made from its arguments: no span of its own.
  const command = (p) => (ctx, start) => {
    const ils = p(ctx);
    if (ils === FAIL) return FAIL;
    const at = () => start;
    return mapSpans(ils, at, at);
  };
  return new Map([
    ['si', command(dosi(tok))],
    ['unit', command(dosi(tok))], // v3 version of si
    ['SI', command(doSI(tok))],
    ['qty', command(doSI(tok))], // v3 version of SI
    ['SIrange', command(doSIrange(true, tok))],
    ['qtyrange', command(doSIrange(true, tok))], // v3 version of SIrange
    ['SIlist', command(doSIlist(tok))],
    ['qtylist', command(doSIlist(tok))], // v3 version of SIlist
    ['numrange', command(doSIrange(false, tok))],
    ['numlist', command(doSInumlist)],
    ['num', command(doSInum)],
    ['ang', command(doSIang)],
  ]);
}

const optionalKeyvals = option([], keyvals);

/**
 * A unit, braced or not.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.dosi
 * @param {Parser<Inlines>} tok
 * @returns {Parser<Inlines>}
 */
const dosi = (tok) => (ctx) => {
  const options = optionalKeyvals(ctx);
  if (options === FAIL) return FAIL;
  return unitOf(options, tok)(ctx);
};

// A unit by `siUnit`, braced or not.
const unitOf = (options, tok) => {
  const unit = siUnit(options, tok);
  return alt(grouped(unit, B.concat), unit);
};

const emptyOr160 = (x) => (x.length === 0 ? x : str(NBSP));

/**
 * `\SI[options]{value}[prefix]{unit}`: e.g. `\SI{1}[\$]{}` as "$ 1",
 * `\SI{1}{\euro}` as "1 €".
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.doSI
 * @param {Parser<Inlines>} tok
 * @returns {Parser<Inlines>}
 */
const doSI = (tok) => {
  const prefix = option([], bracketed(tok, B.concat));
  const unitP = dosi(tok);
  return (ctx) => {
    if (skipopts(ctx) === FAIL) return FAIL;
    const value = doSInum(ctx);
    if (value === FAIL) return FAIL;
    const valueprefix = prefix(ctx);
    if (valueprefix === FAIL) return FAIL;
    const unit = unitP(ctx);
    if (unit === FAIL) return FAIL;
    return B.concat([
      valueprefix,
      emptyOr160(valueprefix),
      value,
      emptyOr160(unit),
      unit,
    ]);
  };
};

/**
 * `\num[options]{number}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.doSInum
 * @type {Parser<Inlines>}
 */
function doSInum(ctx) {
  if (skipopts(ctx) === FAIL) return FAIL;
  const v = braced(ctx);
  return v === FAIL ? FAIL : tonum(untokenize(v));
}

/**
 * A number formatted, or its text where it is none.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.tonum
 * @param {string} value
 * @returns {Inlines}
 */
function tonum(value) {
  const { value: num } = parse(parseNum, value);
  return num === FAIL ? B.text(value) : num;
}

// Numbers joined as "a, b, & c".
const listOf = (xs) => {
  if (xs.length === 1) return xs[0];
  const commas = xs
    .slice(0, -1)
    .flatMap((x, k) => (k === 0 ? [x] : [B.concat([str(','), B.space()]), x]));
  return B.concat([...commas, B.text(', & '), xs.at(-1)]);
};

/**
 * `\numlist{a;b;c}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.doSInumlist
 * @type {Parser<Inlines>}
 */
function doSInumlist(ctx) {
  if (skipopts(ctx) === FAIL) return FAIL;
  const v = braced(ctx);
  if (v === FAIL) return FAIL;
  return listOf(untokenize(v).split(';').map(tonum));
}

/**
 * `\SIlist{a;b;c}{unit}`: each number with the unit.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.doSIlist
 * @param {Parser<Inlines>} tok
 * @returns {Parser<Inlines>}
 */
const doSIlist = (tok) => (ctx) => {
  const options = optionalKeyvals(ctx);
  if (options === FAIL) return FAIL;
  const v = braced(ctx);
  if (v === FAIL) return FAIL;
  const nums = untokenize(v).split(';').map(tonum);
  const unit = unitOf(options, tok)(ctx);
  if (unit === FAIL) return FAIL;
  return listOf(nums.map((n) => B.concat([n, str(NBSP), unit])));
};

/**
 * A number to the end, as siunitx formats it.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.parseNum
 * @type {Parser<Inlines>}
 */
function parseNum(ctx) {
  const parts = many(parseNumPart)(ctx);
  if (parts === FAIL || ctx.pos < ctx.text.length) return FAIL;
  return B.concat(parts);
}

/** @see Text.Pandoc.Readers.LaTeX.SIunitx.hyphenToMinus */
const hyphenToMinus = (x) =>
  x.t === 'Str'
    ? new Node('Str', x.c.replaceAll('-', MINUS), x.start, x.end)
    : x;

const isDigit = (c) => c >= '0' && c <= '9';
const numChars = many1(satisfy((c) => isDigit(c) || c === '.'));
const sign = option(
  '',
  alt(
    (ctx) => (char('+')(ctx) === FAIL ? FAIL : ''),
    (ctx) => (char('-')(ctx) === FAIL ? FAIL : MINUS),
  ),
);
const parseParens = (ctx) => {
  if (char('(')(ctx) === FAIL) return FAIL;
  const cs = numChars(ctx);
  return cs === FAIL || char(')')(ctx) === FAIL ? FAIL : cs.join('');
};
const uncertaintyOf = option('', parseParens);

// The uncertainty `u` of `basenum`, written to its decimal places.
function withUncertainty(basenum, u) {
  const dot = basenum.indexOf('.');
  const x = (dot === -1 ? 0 : basenum.length - dot) - 1;
  const y = u.length;
  if (x === 0) return u;
  if (x > y) return `0.${'0'.repeat(x - y)}${u.replace(/0+$/, '')}`;
  const t = u.slice(y - x).replace(/0+$/, '');
  return u.slice(0, y - x) + (t === '' ? '' : `.${t}`);
}

/** @see Text.Pandoc.Readers.LaTeX.SIunitx.parseNumPart */
const parseDecimalNum = attempt((ctx) => {
  const pref = sign(ctx);
  if (pref === FAIL) return FAIL;
  const digits = numChars(ctx);
  if (digits === FAIL) return FAIL;
  const raw = digits.join('');
  const basenum = pref + (raw.startsWith('.') ? `0${raw}` : raw);
  const uncertainty = uncertaintyOf(ctx);
  if (uncertainty === FAIL) return FAIL;
  if (uncertainty === '') return str(basenum);
  return str(basenum + PLUS_MINUS + withUncertainty(basenum, uncertainty));
});

const charAs = (c, ils) => (ctx) => (char(c)(ctx) === FAIL ? FAIL : ils());
const stringAs = (s, ils) =>
  attempt((ctx) => (string(s)(ctx) === FAIL ? FAIL : ils()));

/**
 * A part of a number: digits with their uncertainty, a decimal comma,
 * `+-` or `\pm`, `i`, an exponent, `x`, or spaces.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.parseNumPart
 * @type {Parser<Inlines>}
 */
const parseNumPart = alt(
  parseDecimalNum,
  charAs(',', () => str('.')),
  stringAs('+-', () => str(PLUS_MINUS)),
  stringAs('\\pm', () => str(PLUS_MINUS)),
  charAs('i', () => str('i')),
  (ctx) => {
    if (char('e')(ctx) === FAIL) return FAIL;
    const n = parseDecimalNum(ctx);
    if (n === FAIL) return FAIL;
    return B.concat([str(`${TIMES}10`), B.superscript(n)]);
  },
  charAs('x', () => str(TIMES)),
  (ctx) => (skipMany1(char(' '))(ctx) === FAIL ? FAIL : []),
);

/**
 * `\ang{d;m;s}`: degrees, minutes and seconds, those given.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.doSIang
 * @type {Parser<Inlines>}
 */
function doSIang(ctx) {
  if (skipopts(ctx) === FAIL) return FAIL;
  const v = braced(ctx);
  if (v === FAIL) return FAIL;
  const [d = '', m = '', s = ''] = untokenize(v).split(';');
  const dropPlus = (t) => (t.startsWith('+') ? t.slice(1) : t);
  const part = (t, mark) =>
    t === '' ? [] : B.concat([str(dropPlus(t)), str(mark)]);
  return B.concat([part(d, '°'), part(m, '′'), part(s, '″')]);
}

/**
 * `\SIrange{100}{200}{\ms}` as "100 ms–200 ms"; `\numrange` without the
 * units.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.doSIrange
 * @param {boolean} includeUnits
 * @param {Parser<Inlines>} tok
 * @returns {Parser<Inlines>}
 */
const doSIrange = (includeUnits, tok) => {
  const prefix = option([], bracketed(tok, B.concat));
  const unitP = dosi(tok);
  return (ctx) => {
    if (skipopts(ctx) === FAIL) return FAIL;
    const startvalue = doSInum(ctx);
    if (startvalue === FAIL) return FAIL;
    const startvalueprefix = prefix(ctx);
    if (startvalueprefix === FAIL) return FAIL;
    const stopvalue = doSInum(ctx);
    if (stopvalue === FAIL) return FAIL;
    const stopvalueprefix = prefix(ctx);
    if (stopvalueprefix === FAIL) return FAIL;
    const unit = includeUnits ? unitP(ctx) : [];
    if (unit === FAIL) return FAIL;
    return B.concat([
      startvalueprefix,
      emptyOr160(startvalueprefix),
      startvalue,
      emptyOr160(unit),
      unit,
      B.text('–'), // An en-dash
      stopvalueprefix,
      emptyOr160(stopvalueprefix),
      stopvalue,
      emptyOr160(unit),
      unit,
    ]);
  };
};

const separator = skipMany(
  alt(
    (ctx) => (symbol('.')(ctx) === FAIL ? FAIL : undefined),
    (ctx) => (symbol('~')(ctx) === FAIL ? FAIL : undefined),
    spaces1,
  ),
);

/**
 * A unit: its parts, prefixed, suffixed and joined by `\per` or `/`, with
 * no-break spaces between.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.siUnit
 * @param {[string, string][]} options
 * @param {Parser<Inlines>} tok
 * @returns {Parser<Inlines>}
 */
function siUnit(options, tok) {
  const exponent = (ctx) => {
    const n = tok(ctx);
    return n === FAIL ? FAIL : walkInlines({ inline: hyphenToMinus }, n);
  };
  const powerOf = (name, n) => (ctx) => {
    if (controlSeq(name)(ctx) === FAIL || skipopts(ctx) === FAIL) return FAIL;
    return (u) => B.concat([u, B.superscript(str(n))]);
  };
  const raisedBy = (head, wrap) => (ctx) => {
    if (head(ctx) === FAIL) return FAIL;
    const n = exponent(ctx);
    return n === FAIL ? FAIL : (u) => B.concat([u, wrap(n)]);
  };
  const skipping = (name) => (ctx) =>
    controlSeq(name)(ctx) === FAIL ? FAIL : skipopts(ctx);
  const siPrefix = alt(
    powerOf('square', '2'),
    powerOf('cubic', '3'),
    raisedBy(skipping('raisetothe'), B.superscript),
  );
  const siSuffix = alt(
    powerOf('squared', '2'),
    powerOf('cubed', '3'),
    raisedBy(skipping('tothe'), B.superscript),
    raisedBy(symbol('^'), B.superscript),
    raisedBy(symbol('_'), B.subscript),
  );
  const prefixed = (ctx) => {
    const f = siPrefix(ctx);
    if (f === FAIL) return FAIL;
    const b = siBase(ctx);
    return b === FAIL ? FAIL : f(b);
  };
  const suffixed = (ctx) => {
    const u = alt(siBase, tok)(ctx);
    if (u === FAIL) return FAIL;
    const f = option(null, siSuffix)(ctx);
    if (f === FAIL) return FAIL;
    return f === null ? u : f(u);
  };
  const useSlash = options.find(([k]) => k === 'per-mode')?.[1] === 'symbol';
  const siInfix = (u1) =>
    attempt(
      alt(
        (ctx) => {
          if (controlSeq('per')(ctx) === FAIL) return FAIL;
          const u2 = siUnitPart(ctx);
          if (u2 === FAIL) return FAIL;
          return useSlash
            ? B.concat([u1, str('/'), u2])
            : B.concat([u1, str(NBSP), negateExponent(u2)]);
        },
        (ctx) => {
          if (symbol('/')(ctx) === FAIL) return FAIL;
          const u2 = siUnitPart(ctx);
          return u2 === FAIL ? FAIL : B.concat([u1, str('/'), u2]);
        },
      ),
    );
  const siUnitPart = attempt((ctx) => {
    if (separator(ctx) === FAIL) return FAIL;
    const x = alt(prefixed, suffixed)(ctx);
    if (x === FAIL) return FAIL;
    return option(x, siInfix(x))(ctx);
  });
  const parts = many1(siUnitPart);
  return (ctx) => {
    const ps = parts(ctx);
    if (ps === FAIL) return FAIL;
    return B.concat(ps.flatMap((p, k) => (k === 0 ? [p] : [str(NBSP), p])));
  };
}

/**
 * A unit's exponent negated, `⁻¹` where it has none.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.siUnit
 * @param {Inlines} ils
 */
function negateExponent(ils) {
  const last = ils.at(-1);
  if (last?.t === 'Superscript') {
    return B.concat([
      ils.slice(0, -1),
      B.superscript(B.concat([str(MINUS), last.c])),
    ]);
  }
  return B.concat([ils, B.superscript(str(`${MINUS}1`))]);
}

/**
 * A unit command, prefixed by any modifiers; else a word.
 *
 * @see Text.Pandoc.Readers.LaTeX.SIunitx.siUnit
 * @type {Parser<Inlines>}
 */
const siBase = alt(
  attempt((ctx) => {
    const cs = anyControlSeq(ctx);
    if (cs === FAIL) return FAIL;
    const modifier = SI_UNIT_MODIFIERS.get(cs.name);
    if (modifier !== undefined) {
      const b = siBase(ctx);
      return b === FAIL ? FAIL : B.concat([str(modifier), b]);
    }
    const unit = SI_UNITS.get(cs.name);
    // not a unit command
    return unit === undefined ? FAIL : unit();
  }),
  (ctx) => {
    const t = satisfyTok(isWordTok)(ctx);
    return t === FAIL ? FAIL : str(t.text);
  },
);

/** @see Text.Pandoc.Readers.LaTeX.SIunitx.siUnitModifierMap */
const SI_UNIT_MODIFIERS = new Map([
  ['atto', 'a'],
  ['centi', 'c'],
  ['deca', 'd'],
  ['deci', 'd'],
  ['deka', 'd'],
  ['exa', 'E'],
  ['femto', 'f'],
  ['giga', 'G'],
  ['hecto', 'h'],
  ['kilo', 'k'],
  ['mega', 'M'],
  ['micro', 'μ'],
  ['milli', 'm'],
  ['nano', 'n'],
  ['peta', 'P'],
  ['pico', 'p'],
  ['tera', 'T'],
  ['yocto', 'y'],
  ['yotta', 'Y'],
  ['zepto', 'z'],
  ['zetta', 'Z'],
]);

// An emphasized symbol with a subscript.
const subscripted = (x, sub) => () =>
  B.concat([B.emph(str(x)), B.subscript(str(sub))]);

/** @see Text.Pandoc.Readers.LaTeX.SIunitx.siUnitMap */
const SI_UNITS = new Map([
  ...[
    ['fg', 'fg'],
    ['pg', 'pg'],
    ['ng', 'ng'],
    ['ug', 'μg'],
    ['mg', 'mg'],
    ['g', 'g'],
    ['kg', 'kg'],
    ['amu', 'u'],
    ['pm', 'pm'],
    ['nm', 'nm'],
    ['um', 'μm'],
    ['mm', 'mm'],
    ['cm', 'cm'],
    ['dm', 'dm'],
    ['m', 'm'],
    ['km', 'km'],
    ['as', 'as'],
    ['fs', 'fs'],
    ['ps', 'ps'],
    ['ns', 'ns'],
    ['us', 'μs'],
    ['ms', 'ms'],
    ['s', 's'],
    ['fmol', 'fmol'],
    ['pmol', 'pmol'],
    ['nmol', 'nmol'],
    ['umol', 'μmol'],
    ['mmol', 'mmol'],
    ['mol', 'mol'],
    ['kmol', 'kmol'],
    ['pA', 'pA'],
    ['nA', 'nA'],
    ['uA', 'μA'],
    ['mA', 'mA'],
    ['A', 'A'],
    ['kA', 'kA'],
    ['ul', 'μl'],
    ['ml', 'ml'],
    ['l', 'l'],
    ['hl', 'hl'],
    ['uL', 'μL'],
    ['mL', 'mL'],
    ['L', 'L'],
    ['hL', 'hL'],
    ['mHz', 'mHz'],
    ['Hz', 'Hz'],
    ['kHz', 'kHz'],
    ['MHz', 'MHz'],
    ['GHz', 'GHz'],
    ['THz', 'THz'],
    ['mN', 'mN'],
    ['N', 'N'],
    ['kN', 'kN'],
    ['MN', 'MN'],
    ['Pa', 'Pa'],
    ['kPa', 'kPa'],
    ['MPa', 'MPa'],
    ['GPa', 'GPa'],
    ['mohm', 'mΩ'],
    ['kohm', 'kΩ'],
    ['Mohm', 'MΩ'],
    ['pV', 'pV'],
    ['nV', 'nV'],
    ['uV', 'μV'],
    ['mV', 'mV'],
    ['V', 'V'],
    ['kV', 'kV'],
    ['W', 'W'],
    ['uW', 'μW'],
    ['mW', 'mW'],
    ['kW', 'kW'],
    ['MW', 'MW'],
    ['GW', 'GW'],
    ['J', 'J'],
    ['uJ', 'μJ'],
    ['mJ', 'mJ'],
    ['kJ', 'kJ'],
    ['eV', 'eV'],
    ['meV', 'meV'],
    ['keV', 'keV'],
    ['MeV', 'MeV'],
    ['GeV', 'GeV'],
    ['TeV', 'TeV'],
    ['kWh', 'kWh'],
    ['F', 'F'],
    ['fF', 'fF'],
    ['pF', 'pF'],
    ['K', 'K'],
    ['dB', 'dB'],
    ['ampere', 'A'],
    ['angstrom', 'Å'],
    ['arcmin', '′'],
    ['arcminute', '′'],
    ['arcsecond', '″'],
    ['astronomicalunit', 'au'],
    ['atomicmassunit', 'u'],
    ['bar', 'bar'],
    ['barn', 'b'],
    ['becquerel', 'Bq'],
    ['bel', 'B'],
  ].map(([name, t]) => [name, () => str(t)]),
  ['bohr', subscripted('a', '0')],
  ['candela', () => str('cd')],
  ['celsius', () => str('°C')],
  ['clight', subscripted('c', '0')],
  ...[
    ['coulomb', 'C'],
    ['dalton', 'Da'],
    ['day', 'd'],
    ['decibel', 'db'],
    ['degreeCelsius', '°C'],
    ['degree', '°'],
  ].map(([name, t]) => [name, () => str(t)]),
  ['electronmass', subscripted('m', 'e')],
  ['electronvolt', () => str('eV')],
  ['elementarycharge', () => B.emph(str('e'))],
  ['farad', () => str('F')],
  ['gram', () => str('g')],
  ['gray', () => str('Gy')],
  ['hartree', subscripted('E', 'h')],
  ...[
    ['hectare', 'ha'],
    ['henry', 'H'],
    ['hertz', 'Hz'],
    ['hour', 'h'],
    ['joule', 'J'],
    ['katal', 'kat'],
    ['kelvin', 'K'],
    ['kilogram', 'kg'],
    ['knot', 'kn'],
    ['liter', 'L'],
    ['litre', 'l'],
    ['lumen', 'lm'],
    ['lux', 'lx'],
    ['meter', 'm'],
    ['metre', 'm'],
    ['minute', 'min'],
    ['mmHg', 'mmHg'],
    ['mole', 'mol'],
    ['nauticalmile', 'M'],
    ['neper', 'Np'],
    ['newton', 'N'],
    ['ohm', 'Ω'],
    ['Pa', 'Pa'],
    ['pascal', 'Pa'],
    ['percent', '%'],
  ].map(([name, t]) => [name, () => str(t)]),
  ['planckbar', () => B.emph(str('ℏ'))],
  ...[
    ['radian', 'rad'],
    ['second', 's'],
    ['siemens', 'S'],
    ['sievert', 'Sv'],
    ['steradian', 'sr'],
    ['tesla', 'T'],
    ['tonne', 't'],
    ['volt', 'V'],
    ['watt', 'W'],
    ['weber', 'Wb'],
  ].map(([name, t]) => [name, () => str(t)]),
]);
