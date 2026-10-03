// The combinators against Parsec 3.1's semantics: which failures consume
// input, and what each combinator does with a failure that does and one that
// does not.

// cspell:ignore abax

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alt,
  anyChar,
  attempt,
  between,
  char,
  choice,
  count,
  endBy,
  endBy1,
  eof,
  FAIL,
  lookAhead,
  many,
  many1,
  manyTill,
  notFollowedBy,
  option,
  optional,
  optionMaybe,
  parse,
  sepBy,
  sepBy1,
  sepEndBy,
  sepEndBy1,
  skipMany,
  skipMany1,
  string,
} from '../src/index.js';

// Where a parse ends: its value, and how far it read. A failure that read
// nothing is empty; one that read is consumed.
const run = (p, text, state) => {
  const { value, pos, state: after } = parse(p, text, state);
  return value === FAIL
    ? { failed: pos === 0 ? 'empty' : 'consumed', state: after }
    : { value, pos, state: after };
};

// A parser that writes the state, then runs `p`.
const marking = (mark, p) => (ctx) => {
  ctx.state = mark;
  return p(ctx);
};

test('string: a mismatch on its first character is empty', () => {
  assert.deepEqual(run(string('ab'), 'xb'), {
    failed: 'empty',
    state: undefined,
  });
});

test('string: a mismatch after its first character consumes', () => {
  assert.equal(run(string('ab'), 'ax').failed, 'consumed');
});

test('string: running out of input after a match consumes', () => {
  assert.equal(run(string('ab'), 'a').failed, 'consumed');
});

test('string: a match reads it all', () => {
  assert.deepEqual(run(string('ab'), 'abc'), {
    value: 'ab',
    pos: 2,
    state: undefined,
  });
});

test('attempt: a consumed failure becomes empty, its state undone', () => {
  assert.deepEqual(run(attempt(marking('x', string('ab'))), 'ax', 's'), {
    failed: 'empty',
    state: 's',
  });
});

test('alt: the next alternative runs after an empty failure', () => {
  assert.deepEqual(run(alt(string('ab'), string('xy')), 'xy').value, 'xy');
});

test('alt: no alternative runs after a consumed failure', () => {
  assert.equal(run(alt(string('ab'), string('ax')), 'ax').failed, 'consumed');
});

test('alt: attempt lets the next alternative run', () => {
  assert.equal(run(alt(attempt(string('ab')), string('ax')), 'ax').value, 'ax');
});

test('alt: an empty failure leaves no state behind', () => {
  const failing = marking('x', () => FAIL);
  assert.deepEqual(run(alt(failing, string('a')), 'a', 's'), {
    value: 'a',
    pos: 1,
    state: 's',
  });
});

test('alt: none succeeding fails empty', () => {
  assert.equal(run(alt(char('a'), char('b')), 'c').failed, 'empty');
});

test('choice: alt over a list', () => {
  assert.equal(run(choice([char('a'), char('b')]), 'b').value, 'b');
});

test('lookAhead: a success reads nothing and keeps no state', () => {
  assert.deepEqual(run(lookAhead(marking('x', string('ab'))), 'ab', 's'), {
    value: 'ab',
    pos: 0,
    state: 's',
  });
});

test('lookAhead: a consumed failure stays consumed', () => {
  assert.equal(run(lookAhead(string('ab')), 'ax').failed, 'consumed');
});

test('notFollowedBy: succeeds, reading nothing, where p fails', () => {
  assert.deepEqual(run(notFollowedBy(string('ab')), 'ax', 's'), {
    value: undefined,
    pos: 0,
    state: 's',
  });
});

test('notFollowedBy: fails empty where p succeeds consuming', () => {
  assert.equal(run(notFollowedBy(string('ab')), 'ab').failed, 'empty');
});

test('many: stops at an empty failure', () => {
  assert.deepEqual(run(many(char('a')), 'aab').value, ['a', 'a']);
});

test('many: none is no failure', () => {
  assert.deepEqual(run(many(char('a')), 'b'), {
    value: [],
    pos: 0,
    state: undefined,
  });
});

test('many: a consumed failure fails it', () => {
  assert.equal(run(many(string('ab')), 'abax').failed, 'consumed');
});

test('many: a parser accepting the empty string is an error', () => {
  assert.throws(() => run(many(optional(char('a'))), 'b'));
});

test('many1: one at least', () => {
  assert.equal(run(many1(char('a')), 'b').failed, 'empty');
  assert.deepEqual(run(many1(char('a')), 'ab').value, ['a']);
});

test('skipMany and skipMany1: as many and many1, the values dropped', () => {
  assert.deepEqual(run(skipMany(char('a')), 'aab'), {
    value: undefined,
    pos: 2,
    state: undefined,
  });
  assert.equal(run(skipMany1(char('a')), 'b').failed, 'empty');
  assert.equal(run(skipMany(string('ab')), 'abax').failed, 'consumed');
});

test('manyTill: end is tried before each p', () => {
  assert.deepEqual(run(manyTill(anyChar, char('.')), 'ab.c'), {
    value: ['a', 'b'],
    pos: 3,
    state: undefined,
  });
});

test('manyTill: a consumed failure of end fails it', () => {
  assert.equal(run(manyTill(anyChar, string('.x')), 'a.b').failed, 'consumed');
});

test('manyTill: attempt around end lets p read on', () => {
  assert.equal(run(manyTill(anyChar, attempt(string('.x'))), 'a.b.x').pos, 5);
});

test('manyTill: p failing before end fails it', () => {
  assert.equal(run(manyTill(char('a'), char('.')), 'ab').failed, 'consumed');
});

test('option: the default on an empty failure, its state undone', () => {
  assert.deepEqual(run(option('d', marking('x', char('a'))), 'b', 's'), {
    value: 'd',
    pos: 0,
    state: 's',
  });
});

test('option: a consumed failure fails it', () => {
  assert.equal(run(option('d', string('ab')), 'ax').failed, 'consumed');
});

test('optionMaybe and optional: null and undefined where p fails empty', () => {
  assert.equal(run(optionMaybe(char('a')), 'b').value, null);
  assert.equal(run(optionMaybe(char('a')), 'a').value, 'a');
  assert.deepEqual(run(optional(char('a')), 'a'), {
    value: undefined,
    pos: 1,
    state: undefined,
  });
  assert.equal(run(optional(string('ab')), 'ax').failed, 'consumed');
});

test('eof: only at the end, reading nothing', () => {
  assert.deepEqual(run(eof, ''), {
    value: undefined,
    pos: 0,
    state: undefined,
  });
  assert.equal(run(eof, 'a').failed, 'empty');
});

test('count: exactly n, none at zero', () => {
  assert.deepEqual(run(count(2, anyChar), 'abc').value, ['a', 'b']);
  assert.equal(run(count(2, anyChar), 'a').failed, 'consumed');
  assert.deepEqual(run(count(0, anyChar), 'a').value, []);
});

test('between: the middle value', () => {
  assert.equal(run(between(char('('), char(')'), anyChar), '(a)').value, 'a');
});

test('sepBy and sepBy1: separated, a dangling separator consumed', () => {
  const comma = char(',');
  assert.deepEqual(run(sepBy(char('a'), comma), 'a,a').value, ['a', 'a']);
  assert.deepEqual(run(sepBy(char('a'), comma), 'b').value, []);
  assert.equal(run(sepBy1(char('a'), comma), 'b').failed, 'empty');
  assert.equal(run(sepBy(char('a'), comma), 'a,b').failed, 'consumed');
});

test('endBy and endBy1: each one ended', () => {
  const semi = char(';');
  assert.deepEqual(run(endBy(char('a'), semi), 'a;a;').value, ['a', 'a']);
  assert.equal(run(endBy(char('a'), semi), 'a;a').failed, 'consumed');
  assert.equal(run(endBy1(char('a'), semi), 'b').failed, 'empty');
});

test('sepEndBy and sepEndBy1: a separator after the last optional', () => {
  const semi = char(';');
  assert.deepEqual(run(sepEndBy(char('a'), semi), 'a;a').value, ['a', 'a']);
  assert.deepEqual(run(sepEndBy(char('a'), semi), 'a;a;').pos, 4);
  assert.deepEqual(run(sepEndBy(char('a'), semi), '').value, []);
  assert.equal(run(sepEndBy1(char('a'), semi), 'b').failed, 'empty');
  assert.equal(run(sepEndBy(string('ab'), semi), 'ab;ax').failed, 'consumed');
});

test('sepBy and sepEndBy: each empty result a list of its own', () => {
  for (const many0 of [sepBy, sepEndBy]) {
    const p = many0(char('a'), char(','));
    const first = run(p, 'b').value;
    first.push('x');
    assert.deepEqual(run(p, 'b').value, []);
  }
});

// A parser reading nothing that counts in the state, and one ending at 2.
const bump = (ctx) => {
  ctx.state += 1;
  return ctx.state;
};
const atTwo = (ctx) => (ctx.state === 2 ? true : FAIL);

test('manyTill: a round changing only the state goes on', () => {
  assert.deepEqual(run(manyTill(bump, atTwo), '', 0).value, [1, 2]);
});

test('manyTill and sepEndBy1: a round changing nothing throws', () => {
  const nothing = () => undefined;
  assert.throws(() =>
    run(
      manyTill(nothing, () => FAIL),
      'a',
    ),
  );
  assert.throws(() => run(sepEndBy1(nothing, nothing), 'a'));
});

test('notFollowedBy: succeeds where p succeeds without consuming', () => {
  assert.equal(run(notFollowedBy(eof), '').value, undefined);
  assert.equal(run(notFollowedBy(lookAhead(char('a'))), 'a').value, undefined);
});
