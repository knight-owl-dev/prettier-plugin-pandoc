// An immutable map that shares structure between versions, as Haskell's
// `Data.Map` does: parser state holds it, a write makes a new version in
// O(log n), and backtracking restores the old one by reference.
//
// A hash array mapped trie: 32 slots a level, chosen by 5 bits of the key's
// hash at a time; keys whose hashes collide in full share a bucket.

const BITS = 5;
const WIDTH = 1 << BITS;
const MASK = WIDTH - 1;
const LEVELS = Math.ceil(32 / BITS);

// FNV-1a over the UTF-16 code units.
function hash(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A slot holds nothing, a `Leaf`, a bucket of leaves (an array of them, at
// the last level), or a child level (an array of `WIDTH` slots).
class Leaf {
  constructor(key, value) {
    this.key = key;
    this.value = value;
  }
}

const slotOf = (h, level) => (h >>> (level * BITS)) & MASK;

function lookup(node, key, h, level) {
  const slot = node[slotOf(h, level)];
  if (slot === undefined) return undefined;
  if (slot instanceof Leaf) return slot.key === key ? slot : undefined;
  if (level === LEVELS - 1) return slot.find((leaf) => leaf.key === key);
  return lookup(slot, key, h, level + 1);
}

// `node` with `leaf` set, copying only the path to it.
function insert(node, leaf, h, level) {
  const copy = node.slice();
  const i = slotOf(h, level);
  const slot = node[i];
  if (slot === undefined || (slot instanceof Leaf && slot.key === leaf.key)) {
    copy[i] = leaf;
  } else if (level === LEVELS - 1) {
    const bucket = slot instanceof Leaf ? [slot] : slot;
    copy[i] = [...bucket.filter((l) => l.key !== leaf.key), leaf];
  } else if (slot instanceof Leaf) {
    const child = insert(new Array(WIDTH), slot, hash(slot.key), level + 1);
    copy[i] = insert(child, leaf, h, level + 1);
  } else {
    copy[i] = insert(slot, leaf, h, level + 1);
  }
  return copy;
}

/**
 * An immutable map from strings: `set` returns a new map, the old one
 * unchanged.
 *
 * @template V
 */
export class PersistentMap {
  /**
   * @param {Array<unknown>} [root]
   * @param {number} [size]
   */
  constructor(root = new Array(WIDTH), size = 0) {
    this.root = root;
    this.size = size;
  }

  /**
   * @param {string} key
   * @returns {V | undefined}
   */
  get(key) {
    return lookup(this.root, key, hash(key), 0)?.value;
  }

  /** @param {string} key */
  has(key) {
    return lookup(this.root, key, hash(key), 0) !== undefined;
  }

  /**
   * This map with `key` set to `value`.
   *
   * @param {string} key
   * @param {V} value
   * @returns {PersistentMap<V>}
   */
  set(key, value) {
    const h = hash(key);
    const size = this.has(key) ? this.size : this.size + 1;
    return new PersistentMap(
      insert(this.root, new Leaf(key, value), h, 0),
      size,
    );
  }
}

/** The empty map. */
export const EMPTY_MAP = new PersistentMap();
