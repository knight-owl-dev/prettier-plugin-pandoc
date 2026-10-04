// The LaTeX reader's parsing toolkit: the token stream, its helpers, and
// the macros Pandoc expands itself. Pandoc's LaTeX reader checks these end
// to end once the reader's parsers are ported.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAIL } from '../src/core.js';
import {
  anyTok,
  braced,
  bracketedToks,
  defaultLaTeXState,
  dimenarg,
  getRawCommand,
  keyvals,
  lpContext,
  peekTok,
  skipopts,
  sp,
  streamOf,
  tokenize,
  tokensOf,
  untokenize,
  verbEnv,
  withRaw,
} from '../src/latex/parsing.js';
import { readerOptions } from '../src/options.js';

const context = (text) =>
  lpContext(streamOf(tokenize(text)), defaultLaTeXState(readerOptions()));

// `parser` on `text`: its value, the text it read, and what is left.
function run(parser, text) {
  const ctx = context(text);
  const value = parser(ctx);
  const rest = untokenize(tokensOf(ctx.state.input));
  return { value, rest };
}

test('the position moves to the next token', () => {
  const ctx = context('\\foo{x}\ny');
  anyTok(ctx);
  assert.deepEqual([ctx.state.line, ctx.state.column, ctx.state.at], [1, 5, 4]);
  for (let k = 0; k < 4; k++) anyTok(ctx);
  assert.deepEqual([ctx.state.line, ctx.state.column], [2, 1]);
  anyTok(ctx);
  assert.deepEqual([ctx.state.line, ctx.state.column, ctx.state.at], [2, 2, 9]);
});

test('braced: nested braces kept, the outer ones dropped', () => {
  const { value, rest } = run(braced, '{a{b}c}d');
  assert.equal(untokenize(value), 'a{b}c');
  assert.equal(rest, 'd');
});

test('sp: spaces and comments over one newline, not a blank line', () => {
  assert.equal(run(sp, '  %c\n  x').rest, 'x');
  assert.equal(run(sp, ' \n\nx').rest, '\n\nx');
});

test('options and overlays', () => {
  assert.equal(run(skipopts, '[a]<1-> [b]{c}').rest, '{c}');
  assert.equal(run(skipopts, '<abc>{c}').rest, '<abc>{c}');
  assert.equal(untokenize(run(bracketedToks, '[a{]}b]c').value), 'a{]}b');
});

test('dimensions', () => {
  assert.equal(run(dimenarg, '=-1.5em x').value, '=-1.5em');
  assert.equal(run(dimenarg, '1.5furlong').value, FAIL);
});

test('key-value lists', () => {
  assert.deepEqual(run(keyvals, '[width=3cm, height = {a,b}, draft]x').value, [
    ['width', '3cm'],
    ['height', 'a,b'],
    ['draft', ''],
  ]);
});

test('unknown commands, raw, by the arguments their names take', () => {
  const raw = (name, text) => run(getRawCommand(name, `\\${name}`), text).value;
  assert.equal(raw('foo', '[x]{a}{b} c'), '\\foo[x]{a}{b}');
  assert.equal(raw('foo', '2.5em{a}'), '\\foo2.5em{a}');
  assert.equal(raw('hskip', '1em plus 2em x'), '\\hskip1em plus 2em');
  assert.equal(raw('def', '\\x#1{y}z'), '\\def\\x#1{y}');
  assert.equal(raw('small', '{x}'), '\\small');
});

test('verbatim environments', () => {
  assert.equal(
    run(verbEnv('verbatim'), '\n a \\x{\n\\end{verbatim}').value,
    ' a \\x{',
  );
});

test('withRaw: the tokens read', () => {
  const { value } = run(withRaw(braced), '{a b}c');
  assert.equal(untokenize(value[1]), '{a b}');
});

test('\\iffalse and \\iftrue expand with macros off', () => {
  assert.equal(
    untokenize([peekTok(context('\\iffalse a\\else b\\fi c'))]),
    'b',
  );
  const ctx = context('\\iftrue a\\else b\\fi c');
  const toks = [];
  for (let t = anyTok(ctx); t !== FAIL; t = anyTok(ctx)) toks.push(t);
  // The spaces after \iftrue and \fi are theirs: gone with them.
  assert.equal(untokenize(toks), 'ac');
});

test('\\ifstrequal picks a branch by its strings', () => {
  const ctx = context('\\ifstrequal{a}{a}{yes}{no}!');
  const toks = [];
  for (let t = anyTok(ctx); t !== FAIL; t = anyTok(ctx)) toks.push(t);
  assert.equal(untokenize(toks), 'yes!');
});

test('\\xspace: a space before a word', () => {
  const ctx = context('\\xspace word');
  assert.equal(anyTok(ctx).type, 'Spaces');
});
