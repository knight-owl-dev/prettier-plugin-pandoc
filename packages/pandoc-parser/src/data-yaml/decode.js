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
 * A key given again in a mapping: its path, as Aeson formats it relative
 * (`.a[0]['b c']`), and the span of the key in the text.
 *
 * @see Data.Yaml.Internal.Warning
 * @typedef {{path: string, start: number, end: number}} DuplicateKey
 */

/**
 * Each document of `text`, decoded; each key given again pushed to
 * `warnings`, the last first, as `Data.Yaml` gives them.
 *
 * @see Data.Yaml.Internal.decodeAllHelper
 * @param {string} text
 * @param {DuplicateKey[]} [warnings]
 * @returns {Value[]}
 */
export function decodeAll(text, warnings = []) {
  const docs = parseAllDocuments(text, {
    schema: 'failsafe',
    uniqueKeys: false,
    merge: false,
    prettyErrors: false,
  });
  if (!Array.isArray(docs)) return [];
  const found = [];
  const values = docs.map((doc) => {
    if (doc.errors.length > 0) throw new YamlError(doc.errors[0].message);
    if (atColumnZero(doc.contents, text)) {
      throw new YamlError('did not find expected <document start>');
    }
    if (doc.contents === null) return null;
    return parseO(doc.contents, { doc, path: [], warnings: found });
  });
  warnings.push(...found.reverse());
  return values;
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
 * Where a decode is: its document, the path to the node, and the duplicate
 * keys found, null under an alias, whose node `Data.Yaml` decoded once.
 *
 * @typedef {{doc: object, path: (string | number)[], warnings: DuplicateKey[] | null}} Decoding
 */

/**
 * A node decoded: scalars resolved, aliases to what they name, mappings
 * with merge keys merged and later keys replacing earlier ones.
 *
 * @see Data.Yaml.Internal.parseO
 * @param {unknown} node
 * @param {Decoding} at
 * @returns {Value}
 */
function parseO(node, at) {
  if (node === null || node === undefined) return null;
  if (isAlias(node)) {
    const target = node.resolve(at.doc);
    if (target === undefined)
      throw new YamlError(`Unknown alias ${node.source}`);
    return parseO(target, { ...at, warnings: null });
  }
  if (isScalar(node)) return textToValue(node.type, node.tag, scalarText(node));
  if (isSeq(node)) {
    return node.items.map((item, n) =>
      parseO(item, { ...at, path: [...at.path, n] }),
    );
  }
  if (isMap(node)) return parseM(node, at);
  throw new YamlError('Unexpected node');
}

/**
 * A mapping: its keys text; `<<` merging a mapping, or a list of them, for
 * the keys not given before it. A key given again is a warning, unless a
 * merge gave it and nothing since.
 *
 * @see Data.Yaml.Internal.parseM
 * @param {object} node
 * @param {Decoding} at
 * @returns {Map<string, Value>}
 */
function parseM(node, at) {
  let front = new Map();
  let merged = new Set();
  for (const { key, value } of node.items) {
    const s = keyText(key, at);
    const path = [...at.path, s];
    const o = parseO(value, { ...at, path });
    if (s === '<<' && (o instanceof Map || Array.isArray(o))) {
      const xs = o instanceof Map ? o : mergeObjects(o);
      merged = new Set([...xs.keys()].filter((k) => !front.has(k)));
      front = new Map([...xs, ...front]);
    } else {
      if (front.has(s) && !merged.has(s) && at.warnings !== null) {
        const [start, end] = key?.range ?? [0, 0];
        at.warnings.push({ path: relativePath(path), start, end });
      }
      merged.delete(s);
      front.set(s, o);
    }
  }
  return front;
}

/**
 * A path as Aeson formats it relative: `.key` for a key of a letter then
 * letters and digits, `['key']` escaped for any other, `[n]` an index.
 *
 * @see Data.Aeson.Types.formatRelativePath
 * @param {(string | number)[]} path
 */
function relativePath(path) {
  return path
    .map((part) => {
      if (typeof part === 'number') return `[${part}]`;
      if (/^\p{L}[\p{L}\p{N}]*$/u.test(part)) return `.${part}`;
      return `['${part.replace(/['\\]/g, '\\$&')}']`;
    })
    .join('');
}

// Mappings in a list merged, earlier keys kept; anything else skipped.
function mergeObjects(list) {
  let out = new Map();
  for (const om of list) if (om instanceof Map) out = new Map([...om, ...out]);
  return out;
}

// A key's text: a scalar's as written, or an alias's to text.
function keyText(key, at) {
  if (isScalar(key)) return scalarText(key);
  if (key === null || key === undefined) return '';
  if (isAlias(key)) {
    const v = parseO(key, at);
    if (typeof v === 'string') return v;
    throw new YamlError('Non-string key alias');
  }
  throw new YamlError('Non-string keys are not supported');
}
