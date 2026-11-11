// The checks of a document before it is decoded, and each node's value:
// tags valid, keys unique, aliases replaced by what they name.
//
// Ported from yamlet's `Yamlet.Internal.Compose`, and the node views of
// `Yamlet.Internal.View` it and the decoder share.

import {
  boolTag,
  coreTagPrefix,
  exponentOutOfRange,
  floatTag,
  intTag,
  isYaml11Bool,
  mapTag,
  nullTag,
  resolvePlainExact,
  resolveTaggedExact,
  seqTag,
  strTag,
  valueTag,
} from './schema.js';

/**
 * A node of a document: a scalar's text, plain or not; a sequence's items;
 * a mapping's pairs; an alias's name. `tag` is the resolved tag, `!` for
 * the non-specific one; `offset` and `end` are where it is in the text.
 *
 * @see Yamlet.Internal.Syntax.Node
 * @typedef {object} Node
 * @property {'scalar' | 'seq' | 'map' | 'alias'} kind
 * @property {number} offset
 * @property {number} end
 * @property {string | null} anchor
 * @property {string | null} tag
 * @property {boolean} [plain]
 * @property {string} [text]
 * @property {Node[]} [items]
 * @property {[Node, Node][]} [pairs]
 * @property {string} [name]
 */

/** @typedef {import('./schema.js').Value} Value */

/**
 * What fails a document: the offset of its node, and why. Pandoc prints a
 * note after some, at the first of two keys; the port reports one error.
 *
 * @see Yamlet.Internal.Compose.Failure
 */
export class Failure extends Error {
  /**
   * @param {number} offset
   * @param {string} message
   */
  constructor(offset, message) {
    super(message);
    this.offset = offset;
  }
}

/**
 * The visits a document's aliases can add, when each document's are few.
 *
 * @see Yamlet.Internal.Utils.minExpansion
 */
const MIN_EXPANSION = 100000;

/**
 * The visits the aliases of a stream's documents can add together: as many
 * as the documents have, at least `MIN_EXPANSION`.
 *
 * @see Yamlet.Internal.Compose.aliasLimit
 * @param {Node[]} roots
 */
export const aliasLimit = (roots) =>
  Math.max(
    MIN_EXPANSION,
    roots.reduce((n, r) => n + syntaxSize(r), 0),
  );

const syntaxSize = (n) =>
  ownVisits(n) +
  (n.items ?? []).reduce((s, x) => s + syntaxSize(x), 0) +
  (n.pairs ?? []).reduce((s, [k, v]) => s + syntaxSize(k) + syntaxSize(v), 0);

// A node is one visit, each character of its anchor, tag and text one more.
const ownVisits = (n) =>
  1 +
  (n.anchor?.length ?? 0) +
  (n.tag !== null && n.tag !== '!' ? n.tag.length : 0) +
  (n.text?.length ?? 0);

/**
 * A document checked: each tag valid for its node, each mapping's keys
 * unique by value, each alias defined before it and outside what it names;
 * each alias replaced by a copy of its node at the alias's offsets. Throws
 * a `Failure`, the first in the document's order; a mapping's keys are
 * checked after its entries. `added` is the visits the documents before
 * added; returned with this one's.
 *
 * yamlet checks a document without aliases or collection keys by a
 * shorter path to the same result.
 *
 * @see Yamlet.Internal.Compose.prepareWithin
 * @see Yamlet.Internal.Compose.numberWithin
 * @see Yamlet.Internal.Compose.expandAliases
 * @param {number} limit
 * @param {number} added
 * @param {Node} root
 * @returns {[Node, number]}
 */
export function prepareWithin(limit, added, root) {
  // An anchor's node, its number and its visits; null while it is composed.
  const anchors = new Map();
  // Equal values get one number, so keys compare by it.
  const shapes = new Map();
  const st = { visits: 0, added };

  // Give the node the number of its shape and define its anchor.
  const number = (sn, node, shape, own, visits) => {
    if (!shapes.has(shape)) shapes.set(shape, shapes.size);
    const id = shapes.get(shape);
    st.visits += own;
    const a = sn.anchor;
    if (a !== null && anchors.get(a) === null) {
      anchors.set(a, { node, id, visits: visits - a.length });
    }
    return { node, id };
  };

  const open = (sn) => {
    if (sn.anchor !== null) anchors.set(sn.anchor, null);
  };

  const go = (sn) => {
    const before = st.visits;
    const own = ownVisits(sn);
    switch (sn.kind) {
      case 'alias': {
        const found = anchors.get(sn.name);
        if (found === undefined) {
          throw new Failure(sn.offset, `undefined alias *${sn.name}`);
        }
        if (found === null) {
          throw new Failure(
            sn.offset,
            `the alias *${sn.name} refers to a node that contains it`,
          );
        }
        if (st.added + found.visits > limit) {
          throw new Failure(
            sn.offset,
            `the aliases add more than ${limit} nodes and characters`,
          );
        }
        st.visits += found.visits;
        st.added += found.visits;
        return { node: copyAt(sn, found.node), id: found.id };
      }
      case 'scalar': {
        const v = scalar(sn);
        open(sn);
        return number(sn, sn, JSON.stringify(['S', shapeOf(v)]), own, own);
      }
      case 'seq': {
        const tag = collectionTag(sn, seqTag);
        open(sn);
        const items = sn.items.map(go);
        const node = { ...sn, items: items.map((x) => x.node) };
        const shape = JSON.stringify(['Q', tag, items.map((x) => x.id)]);
        return number(sn, node, shape, own, st.visits - before + own);
      }
      default: {
        const tag = collectionTag(sn, mapTag);
        open(sn);
        const entries = sn.pairs.map(([k, v]) => [k, go(k), go(v)]);
        checkUniqueNumbers(entries);
        const pairs = entries.map(([, k, v]) => [k.node, v.node]);
        const ids = entries.map(([, k, v]) => [k.id, v.id]).sort(byIds);
        const shape = JSON.stringify(['M', tag, ids]);
        return number(
          sn,
          { ...sn, pairs },
          shape,
          own,
          st.visits - before + own,
        );
      }
    }
  };

  const node = go(root).node;
  return [node, st.added];
}

const byIds = ([a, b], [c, d]) => a - c || b - d;

// The first key equal to one before it fails, at the key.
function checkUniqueNumbers(entries) {
  const seen = new Map();
  for (const [kn, { node, id }] of entries) {
    const first = seen.get(id);
    if (first !== undefined) throw duplicateKey(kn, node, first);
    seen.set(id, kn);
  }
}

/**
 * The failure at a key equal to one before it, by value: `1.0` is `1.00`.
 *
 * @see Yamlet.Internal.Compose.duplicateKey
 * @param {Node} kn The key as written.
 * @param {Node} k The key, aliases replaced.
 * @param {Node} first
 */
function duplicateKey(kn, k, first) {
  const t = inputText(kn);
  const f = inputText(first);
  let message = 'duplicate key';
  if (k.kind === 'scalar' && scalar(k) === '<<') {
    message += ` "<<"${noMergeKeys}`;
  } else if (t !== null && f !== null && t !== f) {
    message += ` ${t}, the same value as the first key`;
  } else if (t !== null) message += ` ${t}`;
  return new Failure(kn.offset, message);
}

/**
 * The hint at a key `<<`: YAML 1.1 merged mappings with it.
 *
 * @see Yamlet.Internal.Compose.noMergeKeys
 */
const noMergeKeys = ', merge keys are not supported';

// A copy of a node at an alias: its offsets the alias's, its anchor gone.
function copyAt(alias, n) {
  const copy = (x) => {
    const c = { ...x, offset: alias.offset, end: alias.end };
    if (x.items) c.items = x.items.map(copy);
    if (x.pairs) c.pairs = x.pairs.map(([k, v]) => [copy(k), copy(v)]);
    return c;
  };
  return { ...copy(n), anchor: null };
}

// A value, by what makes it equal: a float by its value, `1.0` as `1.00`.
function shapeOf(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return ['int', String(v)];
  if ('tag' in v) return ['tagged', v.tag, shapeOf(v.value)];
  const f = v.float;
  if (typeof f === 'string') return ['float', f];
  let [c, e] = [f.coefficient, f.exponent];
  if (c === 0n) return ['float', '0'];
  while (c % 10n === 0n) [c, e] = [c / 10n, e + 1];
  return ['float', String(c), e];
}

/**
 * A scalar's value, its tag kept where it is not the core schema's for
 * the value; a failure where the value is not valid for its tag.
 *
 * @see Yamlet.Internal.Compose.scalar
 * @param {Node} sn
 * @returns {Value}
 */
function scalar(sn) {
  const t = sn.text;
  if (sn.tag === null) {
    if (!sn.plain) return t;
    const { value, exact } = resolvePlainExact(t);
    if (exact) return value;
    throw new Failure(
      sn.offset,
      `${exponentOutOfRange}, quote the value if it is a string, e.g. '${t}'`,
    );
  }
  if (sn.tag === '!') return t;
  if (sn.tag === seqTag || sn.tag === mapTag) {
    throw new Failure(
      sn.offset,
      `the tag ${shortTag(sn.tag)} cannot be used on a scalar`,
    );
  }
  const r = resolveTaggedExact(sn.tag, t);
  if (r === null) {
    const hint =
      sn.tag === boolTag && isYaml11Bool(t)
        ? `, ${showText(t)} is a boolean only in YAML 1.1`
        : '';
    throw new Failure(
      sn.offset,
      `invalid value for the tag ${shortTag(sn.tag)}${hint}`,
    );
  }
  if (!r.exact) throw new Failure(sn.offset, exponentOutOfRange);
  return sn.tag === valueTag(r.value)
    ? r.value
    : { tag: sn.tag, value: r.value };
}

const shortTag = (tag) => `!!${tag.slice(coreTagPrefix.length)}`;

const CORE_TAGS = [nullTag, boolTag, intTag, floatTag, strTag, seqTag, mapTag];

/**
 * A collection's tag: `def` where it has none, a failure where it has
 * another of the core schema's.
 *
 * @see Yamlet.Internal.Compose.collectionTag
 * @param {Node} sn
 * @param {string} def
 */
function collectionTag(sn, def) {
  const { tag } = sn;
  if (tag === null || tag === '!') return def;
  if (tag === def || !CORE_TAGS.includes(tag)) return tag;
  const kind = def === seqTag ? 'sequence' : 'mapping';
  throw new Failure(
    sn.offset,
    `the tag ${shortTag(tag)} cannot be used on a ${kind}`,
  );
}

/**
 * A scalar's value without its tag: one the schema does not know, or no
 * valid value for its tag, makes text.
 *
 * @see Yamlet.Internal.View.scalarValue
 * @param {Node} n
 * @returns {Value}
 */
export function scalarValue(n) {
  if (n.tag === null) return n.plain ? resolvePlainExact(n.text).value : n.text;
  if (n.tag === '!') return n.text;
  const r = resolveTaggedExact(n.tag, n.text);
  return r === null ? n.text : r.value;
}

/**
 * A node's kind in words, for an error: `a list`.
 *
 * @see Yamlet.Internal.View.describeNode
 * @param {Node} n
 */
export function describeNode(n) {
  if (n.kind === 'seq') return 'a list';
  if (n.kind === 'map') return 'a mapping';
  if (n.kind === 'alias') return 'an alias';
  const v = scalarValue(n);
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'a boolean';
  if (typeof v === 'bigint') return 'an integer';
  return typeof v === 'string' ? 'a string' : 'a floating-point number';
}

/**
 * A key as the input writes it, for an error: text quoted, an alias with
 * its `*`, another scalar as it is; null for a collection or nothing.
 *
 * @see Yamlet.Internal.View.inputText
 * @param {Node} n
 * @returns {string | null}
 */
export function inputText(n) {
  if (n.kind === 'alias') return `*${n.name}`;
  if (n.kind !== 'scalar') return null;
  if (typeof scalarValue(n) === 'string') return showText(n.text);
  return n.text === '' ? null : n.text;
}

/**
 * Text in double quotes, escaped as YAML escapes it.
 *
 * @see Yamlet.Internal.Utils.showText
 * @param {string} t
 */
export function showText(t) {
  let out = '"';
  for (const c of t) {
    if (c === '"' || c === '\\') out += `\\${c}`;
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (isPrint(c)) out += c;
    else out += hexEscape(c.codePointAt(0));
  }
  return `${out}"`;
}

function hexEscape(code) {
  const [p, width] =
    code < 0x100 ? ['x', 2] : code < 0x10000 ? ['u', 4] : ['U', 8];
  return `\\${p}${code.toString(16).padStart(width, '0')}`;
}

const UNPRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]$/u;

/**
 * A character a terminal prints: no control, format, surrogate, private
 * use, unassigned or line or paragraph separator. GHC's `Data.Char`.
 *
 * @param {string} c
 */
export const isPrint = (c) => !UNPRINTABLE.test(c);
