// YAML metadata as Pandoc reads it into a document's metadata: each text
// value read again by the reader's own parser.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Metadata`. A value is no
// text of the source as written: what it is read into spans nothing, where
// its block starts.

import { decodeAll, YamlError } from './data-yaml/decode.js';
import { blocksToInlines } from './shared.js';
import { SourceText } from './source-text.js';

/** @typedef {import('./data-yaml/decode.js').Value} Value */
/** @typedef {{t: string, c?: unknown}} MetaValue */
/**
 * Read text again as blocks: Pandoc's `parseFromString'` of the reader's
 * block parser, `FAIL`'s stand-in null where it fails.
 *
 * @typedef {(source: SourceText) => import('./ast/nodes.js').Node[] | null} ReadBlocks
 */

/**
 * The metadata of a YAML block's text: null where it is no mapping, which
 * makes it no metadata block. Text that is no YAML fails the whole read,
 * as it does Pandoc's.
 *
 * @see Text.Pandoc.Readers.Metadata.yamlBsToMeta
 * @param {ReadBlocks} readBlocks
 * @param {string} text
 * @param {number} at Where the block starts.
 * @returns {Record<string, MetaValue> | null}
 */
export function yamlBsToMeta(readBlocks, text, at) {
  let xs;
  try {
    xs = decodeAll(text);
  } catch (e) {
    if (!(e instanceof YamlError)) throw e;
    throw new Error(
      `Error parsing YAML metadata at offset ${at}: ${e.message}`,
    );
  }
  if (xs.length === 0 || (xs.length === 1 && xs[0] === null)) return {};
  const [first] = xs;
  // expected YAML object
  if (!(first instanceof Map)) return null;
  return yamlMap(readBlocks, first, at);
}

/**
 * A mapping as metadata: keys ending in `_` left out.
 *
 * @see Text.Pandoc.Readers.Metadata.yamlMap
 * @param {ReadBlocks} readBlocks
 * @param {Map<string, Value>} o
 * @param {number} at
 * @returns {Record<string, MetaValue>}
 */
function yamlMap(readBlocks, o, at) {
  const keys = [...o.keys()].filter((k) => !k.endsWith('_')).sort(compare);
  return Object.fromEntries(
    keys.map((k) => [k, yamlToMetaValue(readBlocks, o.get(k), at)]),
  );
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A value as metadata: text and numbers read again, booleans as they are,
 * null as empty text.
 *
 * @see Text.Pandoc.Readers.Metadata.yamlToMetaValue
 * @param {ReadBlocks} readBlocks
 * @param {Value} v
 * @param {number} at
 * @returns {MetaValue}
 */
function yamlToMetaValue(readBlocks, v, at) {
  if (typeof v === 'string') return normalizeMetaValue(readBlocks, v, at);
  if (typeof v === 'boolean') return { t: 'MetaBool', c: v };
  if (v === null) return { t: 'MetaString', c: '' };
  if (Array.isArray(v)) {
    return {
      t: 'MetaList',
      c: v.map((x) => yamlToMetaValue(readBlocks, x, at)),
    };
  }
  if (v instanceof Map) return { t: 'MetaMap', c: yamlMap(readBlocks, v, at) };
  return normalizeMetaValue(readBlocks, showNumber(v.number), at);
}

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;

/**
 * A number as Pandoc shows it: an `Int` where it is one, else as Haskell
 * shows a `Scientific`.
 *
 * @see Text.Pandoc.Readers.Metadata.yamlToMetaValue
 * @param {import('./data-yaml/decode.js').Scientific} s
 */
export function showNumber({ coefficient, exponent }) {
  let [c, e] = [coefficient, exponent];
  while (e < 0 && c !== 0n && c % 10n === 0n) [c, e] = [c / 10n, e + 1];
  if (c === 0n) return '0';
  if (e >= 0 && e < 1024) {
    const n = c * 10n ** BigInt(e);
    if (n >= INT_MIN && n <= INT_MAX) return String(n);
  }
  return showScientific(c, e);
}

/**
 * @see Data.Scientific.formatScientific (Generic, as `show` gives it)
 * @param {bigint} c
 * @param {number} e
 */
function showScientific(c, e) {
  if (c < 0n) return `-${showScientific(-c, e)}`;
  const ds = String(c).replace(/0+$/, '');
  // The value as 0.ds × 10^exp.
  const exp = e + String(c).length;
  if (exp < 0 || exp > 7) {
    const [d, ...rest] = ds;
    return `${d}.${rest.length === 0 ? '0' : rest.join('')}e${exp - 1}`;
  }
  if (exp === 0) return `0.${ds}`;
  const whole = ds.slice(0, exp).padEnd(exp, '0');
  const fraction = ds.slice(exp);
  return `${whole}.${fraction === '' ? '0' : fraction}`;
}

const isSpaceChar = (c) => c === ' ' || c === '\t';

/**
 * Text as metadata: blocks where it ends in a newline, as a block scalar
 * does (#6823); else inlines, from its blocks.
 *
 * @see Text.Pandoc.Readers.Metadata.normalizeMetaValue
 * @param {ReadBlocks} readBlocks
 * @param {string} x
 * @param {number} at
 * @returns {MetaValue}
 */
function normalizeMetaValue(readBlocks, x, at) {
  const read = (t) => readBlocks(SourceText.synth(t, at, at));
  let end = x.length;
  while (end > 0 && isSpaceChar(x[end - 1])) end--;
  if (x.slice(0, end).endsWith('\n')) {
    const bs = read(`${x}\n\n`);
    if (bs === null) throw new Error('the metadata reader failed');
    return { t: 'MetaBlocks', c: bs };
  }
  const x2 = x.replace(/^[ \t\r\n]+/, '');
  // see #8358, #8465
  const bs = read(x2) ?? read(`${x2}\n\n`);
  if (bs === null) throw new Error('the metadata reader failed');
  return { t: 'MetaInlines', c: blocksToInlines(bs) };
}
