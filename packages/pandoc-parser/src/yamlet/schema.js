// The core schema of YAML 1.2.2: what a scalar's text resolves to, plain
// or under a tag.
//
// Ported from yamlet's `Yamlet.Internal.Schema` and the tags of
// `Yamlet.Value`.

/**
 * A number as Haskell's `Scientific`: `coefficient` × 10^`exponent`.
 *
 * @typedef {{coefficient: bigint, exponent: number}} Scientific
 */

/**
 * A float: finite, or one a `Scientific` cannot hold.
 *
 * @see Yamlet.Value.FloatValue
 * @typedef {Scientific | 'NegativeZero' | 'Infinity' | 'NegativeInfinity' | 'NaN'} FloatValue
 */

/**
 * A scalar's value: null, a boolean, an integer, a float or text, the
 * tag kept where it is not the core schema's for the value.
 *
 * @see Yamlet.Value.Value
 * @typedef {null | boolean | bigint | {float: FloatValue} | string | {tag: string, value: Value}} Value
 */

/**
 * A value, and whether it is exact: a float past `MAX_EXPONENT` is not.
 *
 * @typedef {{value: Value, exact: boolean}} Resolved
 */

const CORE = 'tag:yaml.org,2002:';

/** @see Yamlet.Internal.Utils.coreTagPrefix */
export const coreTagPrefix = CORE;
export const nullTag = `${CORE}null`;
export const boolTag = `${CORE}bool`;
export const intTag = `${CORE}int`;
export const floatTag = `${CORE}float`;
export const strTag = `${CORE}str`;
export const seqTag = `${CORE}seq`;
export const mapTag = `${CORE}map`;

/**
 * A value's tag: its own, else the core schema's for it.
 *
 * @see Yamlet.Value.valueTag
 * @param {Value} v
 */
export function valueTag(v) {
  if (v === null) return nullTag;
  if (typeof v === 'boolean') return boolTag;
  if (typeof v === 'bigint') return intTag;
  if (typeof v === 'string') return strTag;
  return 'float' in v ? floatTag : v.tag;
}

/**
 * A plain scalar's value, not exact for a float past the limit.
 *
 * @see Yamlet.Internal.Schema.resolvePlainExact
 * @param {string} t
 * @returns {Resolved}
 */
export function resolvePlainExact(t) {
  const exact = (value) => ({ value, exact: true });
  if (t === '') return exact(null);
  const c = t[0];
  if (c === '~' || c === 'n' || c === 'N') return exact(isNull(t) ? null : t);
  if (c === 't' || c === 'T' || c === 'f' || c === 'F') {
    return exact(readBool(t) ?? t);
  }
  if (startsNumber(c)) {
    const i = readInt(t);
    if (i !== null) return exact(i);
    const f = readFloat(t);
    return f === null
      ? exact(t)
      : { value: { float: f.value }, exact: f.exact };
  }
  return exact(t);
}

/**
 * Whether a plain scalar starting with `c` can be a number.
 *
 * @see Yamlet.Internal.Schema.startsNumber
 * @param {string} c
 */
export const startsNumber = (c) =>
  (c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.';

/**
 * A scalar's value under a resolved tag; null where its text is no value
 * of a core tag. A tag the schema does not know makes text.
 *
 * @see Yamlet.Internal.Schema.resolveTaggedExact
 * @param {string} tag
 * @param {string} t
 * @returns {Resolved | null}
 */
export function resolveTaggedExact(tag, t) {
  const exact = (value) => ({ value, exact: true });
  switch (tag) {
    case strTag:
      return exact(t);
    case nullTag:
      return isNull(t) ? exact(null) : null;
    case boolTag: {
      const b = readBool(t);
      return b === null ? null : exact(b);
    }
    case intTag: {
      const i = readInt(t);
      return i === null ? null : exact(i);
    }
    case floatTag: {
      const f = readFloat(t);
      return f === null ? null : { value: { float: f.value }, exact: f.exact };
    }
    case seqTag:
    case mapTag:
      return null;
    default:
      return exact(t);
  }
}

const isNull = (t) =>
  t === '' || t === '~' || t === 'null' || t === 'Null' || t === 'NULL';

const BOOLS = new Map([
  ['true', true],
  ['True', true],
  ['TRUE', true],
  ['false', false],
  ['False', false],
  ['FALSE', false],
]);

const readBool = (t) => BOOLS.get(t) ?? null;

/**
 * A word YAML 1.1 reads as a boolean, YAML 1.2 as text.
 *
 * @see Yamlet.Internal.Schema.isYaml11Bool
 * @param {string} t
 */
export const isYaml11Bool = (t) =>
  /^(?:[yYnN]|yes|Yes|YES|on|On|ON|no|No|NO|off|Off|OFF)$/.test(t);

// [-+]?[0-9]+, 0o[0-7]+ or 0x[0-9a-fA-F]+.
function readInt(t) {
  if (/^0o[0-7]+$/.test(t) || /^0x[0-9a-fA-F]+$/.test(t)) return BigInt(t);
  const m = /^([-+]?)([0-9]+)$/.exec(t);
  if (m === null) return null;
  return m[1] === '-' ? -BigInt(m[2]) : BigInt(m[2]);
}

/**
 * The limit of a float's exponent in scientific notation: past it, the
 * value is not exact.
 *
 * @see Yamlet.Internal.Schema.maxExponent
 */
const MAX_EXPONENT = 1000n;

/** @see Yamlet.Internal.Schema.exponentOutOfRange */
export const exponentOutOfRange = `the exponent of the number is out of the range from -${MAX_EXPONENT} to ${MAX_EXPONENT}`;

const INFINITY = /^\.(?:inf|Inf|INF)$/;
const NAN = /^\.(?:nan|NaN|NAN)$/;
const DECIMAL = /^([0-9]*)(?:\.([0-9]*))?(?:[eE]([-+]?)([0-9]+))?$/;

/**
 * [-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?, [-+]?\.inf or \.nan,
 * each in three capitalizations.
 *
 * @see Yamlet.Internal.Schema.readFloat
 * @param {string} t
 * @returns {{value: FloatValue, exact: boolean} | null}
 */
function readFloat(t) {
  if (NAN.test(t)) return { value: 'NaN', exact: true };
  const negative = t[0] === '-';
  const f = unsigned(negative || t[0] === '+' ? t.slice(1) : t);
  return f === null || !negative ? f : { ...f, value: negateFloat(f.value) };
}

function unsigned(t) {
  if (INFINITY.test(t)) return { value: 'Infinity', exact: true };
  const m = DECIMAL.exec(t);
  if (m === null) return null;
  const [, int, frac = '', sign, exp = '0'] = m;
  if (int === '' && frac === '') return null;
  const e = (sign === '-' ? -BigInt(exp) : BigInt(exp)) - BigInt(frac.length);
  return decimal(int + frac, e);
}

// The digits times 10^e; past the limit, infinity or zero, not exact.
function decimal(ds, e) {
  const c = BigInt(ds);
  if (c === 0n) return { value: { coefficient: 0n, exponent: 0 }, exact: true };
  // The exponent of the first digit that is not zero.
  const leading = e + BigInt(ds.replace(/^0+/, '').length) - 1n;
  if (leading > MAX_EXPONENT || leading < -MAX_EXPONENT) {
    const value = leading > 0n ? 'Infinity' : { coefficient: 0n, exponent: 0 };
    return { value, exact: false };
  }
  return { value: { coefficient: c, exponent: Number(e) }, exact: true };
}

function negateFloat(f) {
  if (f === 'NegativeZero') return { coefficient: 0n, exponent: 0 };
  if (f === 'Infinity') return 'NegativeInfinity';
  if (f === 'NegativeInfinity') return 'Infinity';
  if (f === 'NaN') return f;
  if (f.coefficient === 0n) return 'NegativeZero';
  return { coefficient: -f.coefficient, exponent: f.exponent };
}
