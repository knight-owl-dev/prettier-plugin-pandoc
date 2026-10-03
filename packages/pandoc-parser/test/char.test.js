// Character parsers, which read a code point at a time, and the Data.Char
// predicates they test with, as GHC defines them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alphaNum,
  anyChar,
  char,
  digit,
  FAIL,
  isAlpha,
  isAlphaNum,
  isDigit,
  isLower,
  isSpace,
  isUpper,
  letter,
  newline,
  noneOf,
  oneOf,
  parse,
  satisfy,
  space,
  spaces,
  string,
} from '../src/index.js';

const value = (p, text) => parse(p, text).value;

test('a character outside the BMP is one character', () => {
  assert.equal(value(anyChar, '😀x'), '😀');
  assert.equal(parse(anyChar, '😀x').pos, 2);
  assert.equal(value(letter, '𝐀'), '𝐀');
});

test('string: a mismatch inside its first code point is empty', () => {
  // The first code point of each is a surrogate pair sharing its high half.
  const { value: v, pos } = parse(string('😀a'), '😁a');
  assert.equal(v, FAIL);
  assert.equal(pos, 0);
});

test('satisfy, char, oneOf and noneOf', () => {
  assert.equal(
    value(
      satisfy((c) => c === 'a'),
      'a',
    ),
    'a',
  );
  assert.equal(value(char('a'), 'b'), FAIL);
  assert.equal(value(oneOf('xyz'), 'y'), 'y');
  assert.equal(value(noneOf('xyz'), 'y'), FAIL);
  assert.equal(value(noneOf('xyz'), 'a'), 'a');
  assert.equal(value(anyChar, ''), FAIL);
});

test('isSpace: the Latin-1 spaces, and Unicode space separators only', () => {
  for (const c of [' ', '\t', '\n', '\r', '\f', '\v', ' ', ' ']) {
    assert.ok(isSpace(c), JSON.stringify(c));
  }
  // Line and paragraph separators are no spaces to GHC.
  for (const c of [' ', ' ', '​', 'a']) {
    assert.ok(!isSpace(c), JSON.stringify(c));
  }
});

test('isDigit: ASCII digits only', () => {
  assert.ok(isDigit('7'));
  assert.ok(!isDigit('٣'));
});

test('isAlpha, isAlphaNum, isUpper and isLower: by general category', () => {
  assert.ok(isAlpha('é') && isAlpha('ǅ') && isAlpha('ʰ') && isAlpha('中'));
  assert.ok(!isAlpha('1') && !isAlpha('_'));
  assert.ok(isAlphaNum('٣') && isAlphaNum('Ⅻ') && isAlphaNum('½'));
  assert.ok(isUpper('A') && isUpper('ǅ') && !isUpper('a'));
  assert.ok(isLower('a') && !isLower('ǅ'));
});

test('the named parsers test their predicates', () => {
  assert.equal(value(letter, 'é'), 'é');
  assert.equal(value(digit, '٣'), FAIL);
  assert.equal(value(alphaNum, '٣'), '٣');
  assert.equal(value(space, ' '), ' ');
  assert.equal(value(newline, '\r\n'), FAIL);
  assert.equal(parse(spaces, ' \t\nx').pos, 3);
});

test('a lone surrogate is a character of its own', () => {
  assert.equal(value(anyChar, '\ud800a'), '\ud800');
  assert.equal(value(anyChar, '\udc00a'), '\udc00');
  assert.equal(value(noneOf('a'), '\ud800a'), '\ud800');
});

test('no parser matches half of a surrogate pair', () => {
  assert.equal(value(oneOf('😀'), '\ud83dx'), FAIL);
  assert.equal(value(noneOf('😀'), '\ud83dx'), '\ud83d');
  assert.equal(value(char('\ud83d'), '😀'), FAIL);
  assert.equal(value(string('\ud83d'), '😀'), FAIL);
  assert.equal(parse(string('a\ud83d'), 'a😀').pos, 1);
  assert.equal(value(oneOf('x😀'), '😀'), '😀');
});
