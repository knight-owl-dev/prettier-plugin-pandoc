// An immutable map that shares structure between versions.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_MAP } from '../src/persistent-map.js';

test('set, get and has; an absent key is undefined', () => {
  const map = EMPTY_MAP.set('a', 1).set('b', 2);
  assert.equal(map.get('a'), 1);
  assert.equal(map.get('b'), 2);
  assert.equal(map.get('c'), undefined);
  assert.ok(map.has('a') && !map.has('c'));
  assert.equal(map.size, 2);
});

test('a set leaves the old version as it was', () => {
  const one = EMPTY_MAP.set('a', 1);
  const two = one.set('a', 2).set('b', 3);
  assert.equal(one.get('a'), 1);
  assert.ok(!one.has('b'));
  assert.equal(two.get('a'), 2);
  assert.equal(two.size, 2);
  assert.equal(EMPTY_MAP.size, 0);
});

test('many keys, each kept, each version its own', () => {
  const versions = [EMPTY_MAP];
  for (let n = 0; n < 5000; n++) {
    versions.push(versions.at(-1).set(`key-${n}`, n));
  }
  const last = versions.at(-1);
  assert.equal(last.size, 5000);
  for (let n = 0; n < 5000; n++) assert.equal(last.get(`key-${n}`), n);
  assert.ok(!versions[100].has('key-100') && versions[101].has('key-100'));
});

test('keys named like object properties are keys like any other', () => {
  const map = EMPTY_MAP.set('constructor', 1);
  assert.equal(map.get('constructor'), 1);
  assert.equal(map.get('toString'), undefined);
  assert.ok(!map.has('__proto__'));
});

// Pairs whose 32-bit FNV-1a hashes are equal: they part only in a bucket at
// the last level.
const COLLIDING = [
  ['k32728', 'k261234'],
  ['k32729', 'k261235'],
  ['k32724', 'k261238'],
  ['k32725', 'k261239'],
  ['k32018', 'k261324'],
];

test('keys whose hashes collide share a bucket, each kept apart', () => {
  let map = EMPTY_MAP;
  for (const [a, b] of COLLIDING) map = map.set(a, `${a}!`).set(b, `${b}!`);
  const before = map;
  map = map.set('k261234', 'new');
  assert.equal(map.size, 10);
  assert.equal(map.get('k261234'), 'new');
  assert.equal(map.get('k32728'), 'k32728!');
  assert.equal(before.get('k261234'), 'k261234!');
  for (const [a, b] of COLLIDING.slice(1)) {
    assert.equal(map.get(a), `${a}!`);
    assert.equal(map.get(b), `${b}!`);
  }
  assert.ok(!map.has('k32730'));
});
