// YAML documents as Pandoc reads them: as yamlet decodes them into Aeson's
// values. The `yaml` package parses, its failsafe schema leaving each
// scalar the text it was written as; yamlet's checks, resolution and
// conversion apply on top.
//
// Ported from yamlet's `Yamlet` and `Yamlet.Error`, and the check of a flow
// collection's closing bracket of its `Yamlet.Internal.Parser`.

import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import { isSpace } from '../data-char.js';
import { fromYaml } from './aeson.js';
import {
  aliasLimit,
  Failure,
  isPrint,
  prepareWithin,
  showText,
} from './compose.js';

/** @typedef {import('./aeson.js').Value} Value */
/** @typedef {import('./compose.js').Node} Node */

/**
 * A document Pandoc cannot decode: its error, and the span in the text of
 * what fails.
 */
export class YamlError extends Error {
  /**
   * @param {string} message
   * @param {[number, number]} span
   */
  constructor(message, span) {
    super(message);
    this.span = span;
  }
}

/**
 * Each document of `text`, decoded. A syntax error in any document comes
 * first, the `yaml` package's message; then each document's first failure
 * in turn, its path before it: `author[0]: duplicate key "name"`.
 *
 * @see Yamlet.decodeAll
 * @see Yamlet.decodeDocuments
 * @param {string} text
 * @returns {Value[]}
 */
export function decodeAll(text) {
  const docs = parseAllDocuments(text, {
    schema: 'failsafe',
    uniqueKeys: false,
    merge: false,
    prettyErrors: false,
    resolveKnownTags: false,
    keepSourceTokens: true,
  });
  if (!Array.isArray(docs)) return [];
  const roots = docs.map((doc) => {
    if (doc.errors.length > 0) {
      throw new YamlError(doc.errors[0].message, doc.errors[0].pos);
    }
    return syntax(doc.contents, text, -1, doc.range[0]);
  });
  const limit = aliasLimit(roots);
  let added = 0;
  return roots.map((root) => {
    try {
      let prepared;
      [prepared, added] = prepareWithin(limit, added, root);
      return fromYaml(prepared);
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      const path = renderPath(nodePath(e.offset, root));
      const message = path === '' ? e.message : `${path}: ${e.message}`;
      throw new YamlError(message, [e.offset, e.offset]);
    }
  });
}

/**
 * A node of the `yaml` package's as yamlet's: a missing one an empty plain
 * scalar `at`. A flow collection closing at or left of the column of the
 * block collection it is in fails, as yamlet's parser fails it.
 *
 * @see Yamlet.Internal.Parser.closing
 * @param {unknown} node
 * @param {string} text
 * @param {number} indent The column of the block collection it is in.
 * @param {number} at
 * @returns {Node}
 */
function syntax(node, text, indent, at) {
  if (node === null || node === undefined) {
    const empty = { offset: at, end: at, anchor: null, tag: null };
    return { ...empty, kind: 'scalar', plain: true, text: '' };
  }
  const [offset, end] = node.range;
  const base = {
    offset,
    end,
    anchor: node.anchor ?? null,
    tag: node.tag ?? null,
  };
  if (isAlias(node)) return { ...base, kind: 'alias', name: node.source };
  if (isScalar(node)) {
    // The text before a tag the package knows, `!!binary`, resolves it.
    const plain = node.type === 'PLAIN';
    return { ...base, kind: 'scalar', plain, text: node.source };
  }
  const token = node.srcToken;
  if (token?.type === 'flow-collection') closing(token, text, indent);
  const block = token?.type === 'block-map' || token?.type === 'block-seq';
  const inner = block ? token.indent : indent;
  const child = (x, from) => syntax(x, text, inner, from);
  if (isSeq(node)) {
    return {
      ...base,
      kind: 'seq',
      items: node.items.map((x) => child(x, end)),
    };
  }
  if (!isMap(node)) throw new Error('the yaml package gave an unknown node');
  const pairs = node.items.map(({ key, value }) => {
    const k = child(key, offset);
    return [k, child(value, k.end)];
  });
  return { ...base, kind: 'map', pairs };
}

// A closing bracket first on its line, at or left of `indent`, fails.
function closing(token, text, indent) {
  const [close] = token.end;
  if (close === undefined) return;
  const column = close.offset - text.lastIndexOf('\n', close.offset - 1) - 1;
  if (column > indent) return;
  const kind = close.source === '}' ? 'mapping' : 'sequence';
  const message = `'${close.source}' is indented too little to end the flow ${kind}`;
  throw new YamlError(message, [close.offset, close.offset]);
}

/**
 * A step from a mapping to a value: its key's text, its alias's name, or
 * a collection key; from a sequence, an index.
 *
 * @see Yamlet.Error.PathElement
 * @typedef {{key: string} | {alias: string} | {collection: true} | number} PathElement
 */

/**
 * The path to the outermost node at `offset`: a key's node, and any node
 * within it, has its mapping's.
 *
 * @see Yamlet.Error.nodePaths
 * @param {number} offset
 * @param {Node} root
 * @returns {PathElement[]}
 */
function nodePath(offset, root) {
  const walk = (n, path) => {
    if (n.offset === offset) return path;
    if (offset < n.offset || offset > n.end) return null;
    for (const [i, x] of (n.items ?? []).entries()) {
      const found = walk(x, [...path, i]);
      if (found) return found;
    }
    for (const [k, v] of n.pairs ?? []) {
      if (offset === k.offset || (offset > k.offset && offset < k.end)) {
        return path;
      }
      const found = walk(v, [...path, keyElement(k)]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []) ?? [];
}

const keyElement = (k) => {
  if (k.kind === 'scalar') return { key: k.text };
  return k.kind === 'alias' ? { alias: k.name } : { collection: true };
};

/**
 * A path as `jobs[1].name`: a key quoted where it is empty, starts with
 * `?` or `*`, or has a space, a character that does not print, or one of
 * `.[]"\`.
 *
 * @see Yamlet.Error.renderPath
 * @param {PathElement[]} path
 */
function renderPath(path) {
  return path
    .map((e, i) => {
      if (typeof e === 'number') return `[${e}]`;
      const dot = i === 0 ? '' : '.';
      if ('alias' in e) return `${dot}*${e.alias}`;
      if ('collection' in e) return `${dot}?`;
      return `${dot}${plainKey(e.key) ? e.key : showText(e.key)}`;
    })
    .join('');
}

const plainKey = (k) =>
  k !== '' &&
  !/^[?*]/.test(k) &&
  [...k].every((c) => !'.[]"\\'.includes(c) && isPrint(c) && !isSpace(c));
