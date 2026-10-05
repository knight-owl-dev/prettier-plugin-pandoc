// YAML documents as Pandoc reads them: as `Data.Yaml` decodes libyaml's
// events into JSON values. The `yaml` package parses, with its failsafe
// schema so that every scalar stays the text it was written as;
// `Data.Yaml`'s own resolution of scalars, merge keys and duplicate keys
// applies on top.
//
// Ported from yaml 0.11.11.2's `Data.Yaml.Internal`.

import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';

/**
 * A number as Haskell's `Scientific`: `coefficient` × 10^`exponent`.
 *
 * @typedef {{coefficient: bigint, exponent: number}} Scientific
 */

/**
 * A decoded value, as Aeson's: a number is `{number}`, an object a `Map`
 * in the order its keys came.
 *
 * @typedef {null | boolean | string | {number: Scientific} | Value[] | Map<string, Value>} Value
 */

/** A document `Data.Yaml` cannot decode: Pandoc's parse error. */
export class YamlError extends Error {}

const STR_TAG = 'tag:yaml.org,2002:str';

/**
 * Each document of `text`, decoded.
 *
 * @see Data.Yaml.Internal.decodeAllHelper
 * @param {string} text
 * @returns {Value[]}
 */
export function decodeAll(text) {
  const docs = parseAllDocuments(text, {
    schema: 'failsafe',
    uniqueKeys: false,
    merge: false,
    prettyErrors: false,
  });
  if (!Array.isArray(docs)) return [];
  return docs.map((doc) => {
    if (doc.errors.length > 0) throw new YamlError(doc.errors[0].message);
    if (atColumnZero(doc.contents, text)) {
      throw new YamlError('did not find expected <document start>');
    }
    return doc.contents === null ? null : parseO(doc.contents, doc);
  });
}

/**
 * Whether a document's root is a block scalar with content at column 0.
 * libyaml indents a block scalar at least one column, even at the root,
 * where the spec allows none: content at column 0 ends the scalar, and the
 * line is no document start.
 *
 * @see libyaml's yaml_parser_scan_block_scalar (`if (*indent < 1)`)
 * @param {unknown} node
 * @param {string} text
 */
function atColumnZero(node, text) {
  if (!isScalar(node)) return false;
  if (node.type !== 'BLOCK_FOLDED' && node.type !== 'BLOCK_LITERAL') {
    return false;
  }
  const [start, end] = node.range;
  const header = text.indexOf('\n', start);
  if (header < 0 || header >= end) return false;
  return text
    .slice(header + 1, end)
    .split('\n')
    .some((line) => /^\S/.test(line));
}

/**
 * A scalar's value: text as quoted, folded or tagged `!!str`; else null, a
 * boolean, a number or text by what it reads as.
 *
 * @see Data.Yaml.Internal.textToValue
 * @param {string} style The `yaml` package's scalar type.
 * @param {string | undefined} tag
 * @param {string} t
 * @returns {Value}
 */
export function textToValue(style, tag, t) {
  if (style === 'QUOTE_SINGLE' || style === 'QUOTE_DOUBLE') return t;
  if (tag === STR_TAG || style === 'BLOCK_FOLDED') return t;
  if (['null', 'Null', 'NULL', '~', ''].includes(t)) return null;
  if (['y', 'yes', 'on', 'true'].some((ref) => isLike(t, ref))) return true;
  if (['n', 'no', 'off', 'false'].some((ref) => isLike(t, ref))) return false;
  const number = textToScientific(t);
  return number === null ? t : { number };
}

// `t` as `ref` is written: as it is, all capitals, or capitalized.
const isLike = (t, ref) =>
  t === ref ||
  t === ref.toUpperCase() ||
  t === ref[0].toUpperCase() + ref.slice(1);

/**
 * A number: hexadecimal after `0x`, octal after `0o`, else decimal with
 * an optional sign, fraction and exponent; all of `t`, or null.
 *
 * @see Data.Yaml.Internal.textToScientific
 * @param {string} t
 * @returns {Scientific | null}
 */
export function textToScientific(t) {
  if (/^0x[0-9a-fA-F]+$/.test(t))
    return { coefficient: BigInt(t), exponent: 0 };
  if (/^0o[0-7]+$/.test(t)) return { coefficient: BigInt(t), exponent: 0 };
  const m = /^([+-]?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(t);
  if (m === null) return null;
  const [, sign, whole, fraction = '', exp = '0'] = m;
  const digits = BigInt(whole + fraction);
  return {
    coefficient: sign === '-' ? -digits : digits,
    exponent: Number(exp) - fraction.length,
  };
}

// A node's scalar text: what the failsafe schema leaves, null for none.
const scalarText = (node) => (node.value === null ? '' : String(node.value));

/**
 * A node decoded: scalars resolved, aliases to what they name, mappings
 * with merge keys merged and later keys replacing earlier ones.
 *
 * @see Data.Yaml.Internal.parseO
 * @param {unknown} node
 * @param {object} doc
 * @returns {Value}
 */
function parseO(node, doc) {
  if (node === null || node === undefined) return null;
  if (isAlias(node)) {
    const target = node.resolve(doc);
    if (target === undefined)
      throw new YamlError(`Unknown alias ${node.source}`);
    return parseO(target, doc);
  }
  if (isScalar(node)) return textToValue(node.type, node.tag, scalarText(node));
  if (isSeq(node)) return node.items.map((item) => parseO(item, doc));
  if (isMap(node)) return parseM(node, doc);
  throw new YamlError('Unexpected node');
}

/**
 * A mapping: its keys text; `<<` merging a mapping, or a list of them, for
 * the keys not given before it.
 *
 * @see Data.Yaml.Internal.parseM
 * @param {object} node
 * @param {object} doc
 * @returns {Map<string, Value>}
 */
function parseM(node, doc) {
  let front = new Map();
  for (const { key, value } of node.items) {
    const s = keyText(key, doc);
    const o = parseO(value, doc);
    if (s === '<<' && (o instanceof Map || Array.isArray(o))) {
      const merged = o instanceof Map ? o : mergeObjects(o);
      front = new Map([...merged, ...front]);
    } else {
      front.set(s, o);
    }
  }
  return front;
}

// Mappings in a list merged, earlier keys kept; anything else skipped.
function mergeObjects(list) {
  let out = new Map();
  for (const om of list) if (om instanceof Map) out = new Map([...om, ...out]);
  return out;
}

// A key's text: a scalar's as written, or an alias's to text.
function keyText(key, doc) {
  if (isScalar(key)) return scalarText(key);
  if (key === null || key === undefined) return '';
  if (isAlias(key)) {
    const v = parseO(key, doc);
    if (typeof v === 'string') return v;
    throw new YamlError('Non-string key alias');
  }
  throw new YamlError('Non-string keys are not supported');
}
