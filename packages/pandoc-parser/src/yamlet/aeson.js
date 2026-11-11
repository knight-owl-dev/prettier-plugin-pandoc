// A checked document as Aeson's value, as Pandoc reads it: a key is its
// scalar's text, two of the same text failing; `.inf` text, `.nan` null.
//
// Ported from yamlet-aeson's `Yamlet.Aeson`, and the decoder of maps in
// yamlet's `Yamlet.Internal.FromYaml`.

import { describeNode, Failure, inputText, scalarValue } from './compose.js';

/** @typedef {import('./compose.js').Node} Node */
/** @typedef {import('./schema.js').Scientific} Scientific */

/**
 * A decoded value, as Aeson's: a number is `{number}`, an object a `Map`
 * in the order its keys came.
 *
 * @typedef {null | boolean | string | {number: Scientific} | Value[] | Map<string, Value>} Value
 */

// What a node that fails decodes to: its failures are in the list.
const FAILED = Symbol('failed');

/**
 * A checked node as Aeson's value. Throws the failure first in the text;
 * a node's failures are all found, those of a mapping's entries before its
 * keys given again.
 *
 * @see Yamlet.Internal.FromYaml.runParserWithin
 * @param {Node} n
 * @returns {Value}
 */
export function fromYaml(n) {
  const failures = [];
  const v = parseValue(n, failures);
  if (v !== FAILED) return v;
  throw failures.reduce((a, b) => (b.offset < a.offset ? b : a));
}

// Aeson's zero, of exponent -1, as yamlet gives every zero.
const ZERO = { number: { coefficient: 0n, exponent: -1 } };

/**
 * @see Yamlet.Aeson.FromYaml
 * @param {Node} n
 * @param {Failure[]} failures
 * @returns {Value | typeof FAILED}
 */
function parseValue(n, failures) {
  if (n.kind === 'seq') {
    const xs = n.items.map((x) => parseValue(x, failures));
    return xs.includes(FAILED) ? FAILED : xs;
  }
  if (n.kind === 'map') return uniqueEntries(n, failures);
  const v = scalarValue(n);
  if (typeof v === 'bigint') return { number: { coefficient: v, exponent: 0 } };
  if (v === null || typeof v !== 'object') return v;
  const f = v.float;
  if (f === 'Infinity') return '+inf';
  if (f === 'NegativeInfinity') return '-inf';
  if (f === 'NaN') return null;
  if (f === 'NegativeZero' || f.coefficient === 0n) return ZERO;
  return { number: f };
}

/**
 * A mapping's entries, each key its scalar's text: a collection key fails,
 * as does a key of the text of one before it, `"1"` after `1`.
 *
 * @see Yamlet.Internal.FromYaml.uniqueEntries
 * @see Yamlet.Internal.FromYaml.insertUnique
 * @see Yamlet.Aeson.KeyText
 * @param {Node} n
 * @param {Failure[]} failures
 */
function uniqueEntries(n, failures) {
  const out = new Map();
  const again = [];
  let failed = false;
  for (const [k, v] of n.pairs) {
    if (k.kind !== 'scalar') {
      const message = `expected a scalar key, but got ${describeNode(k)}`;
      failures.push(new Failure(k.offset, message));
    }
    const x = parseValue(v, failures);
    if (k.kind !== 'scalar' || x === FAILED) failed = true;
    else if (out.has(k.text)) again.push(k);
    else out.set(k.text, x);
  }
  // yamlet gives the keys given again last first.
  for (const k of again.reverse()) {
    const text = inputText(k);
    const message = `duplicate key${text === null ? '' : ` ${text}`} after conversion`;
    failures.push(new Failure(k.offset, message));
  }
  return failed || again.length > 0 ? FAILED : out;
}
