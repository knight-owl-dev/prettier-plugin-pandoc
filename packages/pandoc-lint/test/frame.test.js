// The layout keystone's manual specifies: the severity and problem, then
// each callout in order under a two-space gutter, prose wrapped at 80.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frame, printable, wrap } from '../src/frame.js';

const render = (severity, callouts, lead) =>
  frame(severity, callouts, lead).join('\n');

test('a problem alone', () => {
  assert.equal(render('ERROR', { problem: 'p' }), 'ERROR: p');
});

test('callouts in the manual order, whatever order they come in', () => {
  const callouts = {
    see: 'https://example.com/',
    remedy: 'Do this.',
    effect: 'This followed.',
    because: 'The rule.',
    verbatim: ['quoted'],
    offenders: ['a.md:1:1: x'],
    choices: ['a', 'b'],
    problem: 'p',
  };
  assert.equal(
    render('WARN', callouts),
    [
      'WARN: p',
      '  a.md:1:1: x',
      '  │ quoted',
      '  The rule.',
      '  This followed.',
      '  Valid: a, b',
      '  Do this.',
      '  See https://example.com/',
    ].join('\n'),
  );
});

test('a long problem wraps at 80 to the gutter', () => {
  const problem = Array.from({ length: 30 }, (_, k) => `w${k}`).join(' ');
  const out = frame('ERROR', { problem });
  assert.ok(out.every((line) => [...line].length <= 80));
  assert.ok(out.slice(1).every((line) => line.startsWith('  w')));
  assert.equal(
    out
      .join(' ')
      .replace(/^ERROR: |\s+/g, ' ')
      .trim(),
    problem,
  );
});

test('values wrap hanging under their label', () => {
  const choices = Array.from({ length: 30 }, (_, k) => `value${k}`);
  const [first, ...rest] = frame('ERROR', { problem: 'p', choices }).slice(1);
  assert.ok(first.startsWith('  Valid: value0,'));
  assert.ok(rest.every((line) => line.startsWith('         value')));
});

test('the lead goes before the severity', () => {
  assert.equal(
    render('WARN', { problem: 'p' }, 'a.md:2:3: '),
    'a.md:2:3: WARN: p',
  );
});

test('a word wider than a line takes one of its own', () => {
  assert.deepEqual(wrap(`a ${'x'.repeat(12)} b`, 10, '', '  '), [
    'a',
    `  ${'x'.repeat(12)}`,
    '  b',
  ]);
});

test('columns are code points', () => {
  assert.deepEqual(wrap('é'.repeat(8) + ' 😀😀', 11, '', ''), [
    `${'é'.repeat(8)} 😀😀`,
  ]);
});

test('control characters show in caret notation, a tab as is', () => {
  assert.equal(printable('a\rb\x1bc\x7fd\te'), 'a^Mb^[c^?d\te');
});

test('relayed lines behind the quote bar, a final newline dropped', () => {
  assert.equal(
    render('WARN', { problem: 'p', verbatim: ['a\nb\n'] }),
    'WARN: p\n  │ a\n  │ b',
  );
});
