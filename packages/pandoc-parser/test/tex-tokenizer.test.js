// TeX tokenized as Pandoc's LaTeX reader tokenizes it, a case per rule of
// `totoks`, its position drifts included. Pandoc maps raw TeX's end back
// by these positions; raw TeX in markdown checks them end to end.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenize, untokenize } from '../src/latex/parsing.js';

// Each token as [type, text, line, column], a name or argument after.
const toks = (text) =>
  [...tokenize(text)].map((t) => [
    t.type,
    t.text,
    t.line,
    t.column,
    ...(t.name === undefined ? [] : [t.name]),
    ...(t.arg === undefined ? [] : [t.arg]),
  ]);

test('words, spaces, newlines, symbols and comments', () => {
  assert.deepEqual(toks('ab 1\n{%x\ny'), [
    ['Word', 'ab', 1, 1],
    ['Spaces', ' ', 1, 3],
    ['Word', '1', 1, 4],
    ['Newline', '\n', 1, 5],
    ['Symbol', '{', 2, 1],
    ['Comment', '%x', 2, 2],
    ['Newline', '\n', 2, 4],
    ['Word', 'y', 3, 1],
  ]);
});

test('control words take the spaces after them', () => {
  assert.deepEqual(toks('\\foo  x\\bar'), [
    ['CtrlSeq', '\\foo  ', 1, 1, 'foo'],
    ['Word', 'x', 1, 7],
    ['CtrlSeq', '\\bar', 1, 8, 'bar'],
  ]);
});

test('control symbols, and a backslash at the end', () => {
  assert.deepEqual(toks('\\{\\\\'), [
    ['CtrlSeq', '\\{', 1, 1, '{'],
    ['CtrlSeq', '\\\\', 1, 3, '\\'],
  ]);
  assert.deepEqual(toks('a\\'), [
    ['Word', 'a', 1, 1],
    ['CtrlSeq', '\\', 1, 2, ' '],
  ]);
});

test('@ is a letter between \\makeatletter and \\makeatother', () => {
  assert.deepEqual(
    toks('\\a@b\\makeatletter\\a@b\\makeatother\\a@b').map(([type, text]) => [
      type,
      text,
    ]),
    [
      ['CtrlSeq', '\\a'],
      ['Symbol', '@'],
      ['Word', 'b'],
      ['CtrlSeq', '\\makeatletter'],
      ['CtrlSeq', '\\a@b'],
      ['CtrlSeq', '\\makeatother'],
      ['CtrlSeq', '\\a'],
      ['Symbol', '@'],
      ['Word', 'b'],
    ],
  );
});

test('a control space before a non-blank line: later lines drift', () => {
  assert.deepEqual(toks('x\\ \n y\nz'), [
    ['Word', 'x', 1, 1],
    ['CtrlSeq', '\\ \n ', 1, 2, ' '],
    ['Word', 'y', 1, 6],
    ['Newline', '\n', 1, 7],
    ['Word', 'z', 2, 1],
  ]);
});

test('a control space before a blank line: the backslash and its spaces', () => {
  assert.deepEqual(toks('\\ \n \nz'), [
    ['CtrlSeq', '\\ ', 1, 1, ' '],
    ['Newline', '\n', 1, 5],
    ['Spaces', ' ', 2, 1],
    ['Newline', '\n', 2, 2],
    ['Word', 'z', 3, 1],
  ]);
});

test('arguments, and ## without digits drifting a column', () => {
  assert.deepEqual(toks('#1##2#x'), [
    ['Arg', '#1', 1, 1, 1],
    ['DeferredArg', '##2', 1, 3, 2],
    ['Symbol', '#', 1, 6],
    ['Word', 'x', 1, 7],
  ]);
  assert.deepEqual(toks('##a'), [
    ['Symbol', '#', 1, 1],
    ['Symbol', '#', 1, 2],
    ['Word', 'a', 1, 2],
  ]);
});

test('^^ escapes, and ^^ before a newline drifting lines', () => {
  assert.deepEqual(toks('^^4a^^z^^\nb^'), [
    ['Esc2', '^^4a', 1, 1],
    ['Esc1', '^^z', 1, 5],
    ['Esc1', '^^\n', 1, 8],
    ['Word', 'b', 1, 11],
    ['Symbol', '^', 1, 12],
  ]);
  assert.deepEqual(toks('^^é'), [
    ['Symbol', '^', 1, 1],
    ['Symbol', '^', 1, 2],
    ['Word', 'é', 1, 3],
  ]);
});

test('tokens keep the span they were read from', () => {
  const text = 'a\\ \n b';
  const spans = [...tokenize(text)].map(({ start, end }) =>
    text.slice(start, end),
  );
  assert.deepEqual(spans, ['a', '\\ \n ', 'b']);
});

test('lazily: the first token without tokenizing the rest', () => {
  const tokens = tokenize(`\\x ${'y '.repeat(1e6)}`);
  assert.equal(tokens.next().value.name, 'x');
});

test('untokenize: a space between a control word and a letter', () => {
  assert.equal(untokenize(tokenize('\\foo{a}')), '\\foo{a}');
  const [cs, , , word] = [...tokenize('\\foo{}a')];
  assert.equal(untokenize([cs, word]), '\\foo a');
});
