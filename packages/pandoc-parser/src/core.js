// Parsec's combinators, with Parsec's semantics, as the port of Pandoc's
// reader composes them.
//
// Ported from parsec 3.1.17's `Text.Parsec.Prim` and
// `Text.Parsec.Combinator`, the parsec Pandoc 3.11 builds with.
//
// A parser is a function of one context per parse, `{text, pos, state}`: it
// returns its value and moves `pos` past what it read, or returns `FAIL`. A
// failure that moved `pos` consumed input, and `alt` tries nothing after it;
// `attempt` — Parsec's `try` — puts `pos` and `state` back. Haskell's `do`
// is plain JS: `const x = p(ctx); if (x === FAIL) return FAIL;`.
//
// V8 makes no tail calls, so repetition loops. `state` is never mutated in
// place, only replaced, so a choice point restores it by reference. Parsec's
// error messages are left out: Pandoc's reader never fails a document.

/** The one value a failed parser returns. */
export const FAIL = Symbol('FAIL');

/**
 * @typedef {object} Context
 * @property {string} text
 * @property {number} pos An offset into `text`, in UTF-16 code units.
 * @property {unknown} state Parsec's user state.
 * @property {number} [depth] How deep in text parsed again `text` is: what
 *   Parsec's source name tells apart, a chunk's being its parent's and
 *   `_chunk`.
 */

/**
 * @template T
 * @typedef {(ctx: Context) => T | typeof FAIL} Parser
 */

/**
 * Run `p` on `text` from its start.
 *
 * @see Text.Parsec.Prim.runParser
 * @template T
 * @param {Parser<T>} p
 * @param {string} text
 * @param {unknown} [state]
 * @returns {{value: T | typeof FAIL, pos: number, state: unknown}} On a
 *   failure, `pos` where it stopped: past 0 if it consumed.
 */
export function parse(p, text, state) {
  const ctx = { text, pos: 0, state };
  const value = p(ctx);
  return { value, pos: ctx.pos, state: ctx.state };
}

// What `orEmpty` returns where `p` failed without consuming.
const EMPTY = Symbol('EMPTY');

// Run `p`. Where it fails without consuming, put the state back and return
// `EMPTY`: Parsec runs what comes next from the state it had.
function orEmpty(ctx, p) {
  const { pos, state } = ctx;
  const x = p(ctx);
  if (x !== FAIL || ctx.pos !== pos) return x;
  ctx.state = state;
  return EMPTY;
}

// Apply `p` until it fails without consuming, its values pushed to `xs` if
// given; false where it fails consuming. A `p` that succeeds without
// consuming is Parsec's `many` error.
function repeat(ctx, p, xs) {
  for (;;) {
    const { pos } = ctx;
    const x = orEmpty(ctx, p);
    if (x === EMPTY) return true;
    if (x === FAIL) return false;
    if (ctx.pos === pos) {
      throw new Error(
        "combinator 'many' is applied to a parser that accepts an empty string",
      );
    }
    xs?.push(x);
  }
}

// Throw where a round of `name` changed neither position nor state: every
// round after it would do the same, and Parsec would loop forever.
function endless(ctx, pos, state, name) {
  if (ctx.pos === pos && ctx.state === state) {
    throw new Error(`${name}: a round read nothing and changed nothing`);
  }
}

// `p`, or a new empty list where it fails without consuming.
const orNone = (p) => (ctx) => {
  const xs = orEmpty(ctx, p);
  return xs === EMPTY ? [] : xs;
};

/**
 * `p`, whose failure consumes nothing: input and state as they were.
 *
 * @see Text.Parsec.Prim.try
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<T>}
 */
export function attempt(p) {
  return (ctx) => {
    const { pos, state } = ctx;
    const x = p(ctx);
    if (x === FAIL) {
      ctx.pos = pos;
      ctx.state = state;
    }
    return x;
  };
}

/**
 * Each parser in turn, while those before it fail without consuming.
 *
 * @see Text.Parsec.Prim.<|>
 * @template T
 * @param {...Parser<T>} ps
 * @returns {Parser<T>}
 */
export function alt(...ps) {
  return (ctx) => {
    for (let n = 0; n < ps.length; n++) {
      const x = orEmpty(ctx, ps[n]);
      if (x !== EMPTY) return x;
    }
    return FAIL;
  };
}

/**
 * `alt` over a list.
 *
 * @see Text.Parsec.Combinator.choice
 * @template T
 * @param {Parser<T>[]} ps
 * @returns {Parser<T>}
 */
export const choice = (ps) => alt(...ps);

/**
 * `p`, reading nothing: input and state as they were. A failure that
 * consumes still does.
 *
 * @see Text.Parsec.Prim.lookAhead
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<T>}
 */
export function lookAhead(p) {
  return (ctx) => {
    const { pos, state } = ctx;
    const x = p(ctx);
    if (x !== FAIL) {
      ctx.pos = pos;
      ctx.state = state;
    }
    return x;
  };
}

/**
 * Succeed where `p` fails, reading nothing either way. As in Parsec, a `p`
 * that succeeds without consuming succeeds here too: its `unexpected` fails
 * empty, so the `return ()` after it runs.
 *
 * @see Text.Parsec.Combinator.notFollowedBy
 * @param {Parser<unknown>} p
 * @returns {Parser<undefined>}
 */
export function notFollowedBy(p) {
  return (ctx) => {
    const { pos, state } = ctx;
    const x = p(ctx);
    const consumed = ctx.pos !== pos;
    ctx.pos = pos;
    ctx.state = state;
    return x === FAIL || !consumed ? undefined : FAIL;
  };
}

/**
 * `p`, or `x` where it fails without consuming.
 *
 * @see Text.Parsec.Combinator.option
 * @template T, D
 * @param {D} x
 * @param {Parser<T>} p
 * @returns {Parser<T | D>}
 */
export function option(x, p) {
  return (ctx) => {
    const y = orEmpty(ctx, p);
    return y === EMPTY ? x : y;
  };
}

/**
 * `p`, or `null` (Haskell's `Nothing`) where it fails without consuming.
 *
 * @see Text.Parsec.Combinator.optionMaybe
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<T | null>}
 */
export const optionMaybe = (p) => option(null, p);

/**
 * `p` or nothing, its value dropped.
 *
 * @see Text.Parsec.Combinator.optional
 * @param {Parser<unknown>} p
 * @returns {Parser<undefined>}
 */
export function optional(p) {
  return (ctx) => (orEmpty(ctx, p) === FAIL ? FAIL : undefined);
}

/**
 * Zero or more of `p`. A `p` that succeeds without consuming throws, as
 * Parsec errors.
 *
 * @see Text.Parsec.Prim.many
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<T[]>}
 */
export function many(p) {
  return (ctx) => {
    const xs = [];
    return repeat(ctx, p, xs) ? xs : FAIL;
  };
}

/**
 * One or more of `p`.
 *
 * @see Text.Parsec.Combinator.many1
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<T[]>}
 */
export function many1(p) {
  return (ctx) => {
    const x = p(ctx);
    if (x === FAIL) return FAIL;
    const xs = [x];
    return repeat(ctx, p, xs) ? xs : FAIL;
  };
}

/**
 * `many`, the values dropped.
 *
 * @see Text.Parsec.Prim.skipMany
 * @param {Parser<unknown>} p
 * @returns {Parser<undefined>}
 */
export function skipMany(p) {
  return (ctx) => (repeat(ctx, p) ? undefined : FAIL);
}

/**
 * `many1`, the values dropped.
 *
 * @see Text.Parsec.Combinator.skipMany1
 * @param {Parser<unknown>} p
 * @returns {Parser<undefined>}
 */
export function skipMany1(p) {
  return (ctx) => (p(ctx) === FAIL || !repeat(ctx, p) ? FAIL : undefined);
}

/**
 * `p` until `end` succeeds, `end` tried first each round. A round that
 * changes nothing throws, where Parsec would loop forever.
 *
 * @see Text.Parsec.Combinator.manyTill
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} end
 * @returns {Parser<T[]>}
 */
export function manyTill(p, end) {
  return (ctx) => {
    const xs = [];
    for (;;) {
      const { pos, state } = ctx;
      const done = orEmpty(ctx, end);
      if (done !== EMPTY) return done === FAIL ? FAIL : xs;
      const x = p(ctx);
      if (x === FAIL) return FAIL;
      endless(ctx, pos, state, 'manyTill');
      xs.push(x);
    }
  };
}

/**
 * `n` of `p`; none where `n` is 0 or less.
 *
 * @see Text.Parsec.Combinator.count
 * @template T
 * @param {number} n
 * @param {Parser<T>} p
 * @returns {Parser<T[]>}
 */
export function count(n, p) {
  return (ctx) => {
    const xs = [];
    for (let k = 0; k < n; k++) {
      const x = p(ctx);
      if (x === FAIL) return FAIL;
      xs.push(x);
    }
    return xs;
  };
}

/**
 * `open`, `p` and `close`: `p`'s value.
 *
 * @see Text.Parsec.Combinator.between
 * @template T
 * @param {Parser<unknown>} open
 * @param {Parser<unknown>} close
 * @param {Parser<T>} p
 * @returns {Parser<T>}
 */
export function between(open, close, p) {
  return (ctx) => {
    if (open(ctx) === FAIL) return FAIL;
    const x = p(ctx);
    if (x === FAIL || close(ctx) === FAIL) return FAIL;
    return x;
  };
}

/**
 * One or more of `p`, separated by `sep`.
 *
 * @see Text.Parsec.Combinator.sepBy1
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} sep
 * @returns {Parser<T[]>}
 */
export function sepBy1(p, sep) {
  const next = (ctx) => (sep(ctx) === FAIL ? FAIL : p(ctx));
  return (ctx) => {
    const x = p(ctx);
    if (x === FAIL) return FAIL;
    const xs = [x];
    return repeat(ctx, next, xs) ? xs : FAIL;
  };
}

/**
 * Zero or more of `p`, separated by `sep`.
 *
 * @see Text.Parsec.Combinator.sepBy
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} sep
 * @returns {Parser<T[]>}
 */
export const sepBy = (p, sep) => orNone(sepBy1(p, sep));

// `p`, then `sep`: `p`'s value.
const ended = (p, sep) => (ctx) => {
  const x = p(ctx);
  return x === FAIL || sep(ctx) === FAIL ? FAIL : x;
};

/**
 * Zero or more of `p`, each ended by `sep`.
 *
 * @see Text.Parsec.Combinator.endBy
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} sep
 * @returns {Parser<T[]>}
 */
export const endBy = (p, sep) => many(ended(p, sep));

/**
 * One or more of `p`, each ended by `sep`.
 *
 * @see Text.Parsec.Combinator.endBy1
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} sep
 * @returns {Parser<T[]>}
 */
export const endBy1 = (p, sep) => many1(ended(p, sep));

/**
 * One or more of `p`, separated and optionally ended by `sep`. A round that
 * changes nothing throws, where Parsec would loop forever.
 *
 * @see Text.Parsec.Combinator.sepEndBy1
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} sep
 * @returns {Parser<T[]>}
 */
export function sepEndBy1(p, sep) {
  return (ctx) => {
    const x = p(ctx);
    if (x === FAIL) return FAIL;
    const xs = [x];
    for (;;) {
      const { pos, state } = ctx;
      const s = orEmpty(ctx, sep);
      if (s === EMPTY) return xs;
      if (s === FAIL) return FAIL;
      const y = orEmpty(ctx, p);
      if (y === EMPTY) return xs;
      if (y === FAIL) return FAIL;
      endless(ctx, pos, state, 'sepEndBy');
      xs.push(y);
    }
  };
}

/**
 * Zero or more of `p`, separated and optionally ended by `sep`.
 *
 * @see Text.Parsec.Combinator.sepEndBy
 * @template T
 * @param {Parser<T>} p
 * @param {Parser<unknown>} sep
 * @returns {Parser<T[]>}
 */
export const sepEndBy = (p, sep) => orNone(sepEndBy1(p, sep));

/**
 * Succeed at the end of the input only, reading nothing.
 *
 * @see Text.Parsec.Combinator.eof
 * @type {Parser<undefined>}
 */
export const eof = (ctx) => (ctx.pos >= ctx.text.length ? undefined : FAIL);
