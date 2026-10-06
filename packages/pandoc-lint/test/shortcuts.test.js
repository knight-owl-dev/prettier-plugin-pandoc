// Shortcuts files: each body's Markdown linted where it is in the YAML,
// and what makes the file no shortcuts file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintShortcuts } from '../src/index.js';

const found = (text) =>
  lintShortcuts('s.yaml', text).map((d) => [
    d.rule,
    d.line,
    d.column,
    text.slice(d.start, d.end).split('\n')[0],
  ]);

// The examples of keystone's manual, shortcuts/writing-shortcuts.
const MANUAL = `garamond:
  class: font
  interface:
    family:
      bind: class.family
      default: eb-garamond
    size:
      bind: class.size
ornament:
  class: align
  interface:
    style:
      bind: class.style
      default: center
  body: |
    ~ ~ ~
pullquote:
  class: align
  content: font
  body: |
    ::: rule
    :::
    ::: font
    :::
    ::: rule
    :::
epigraph:
  class: font
  content: slot
  body: |
    ::: quote
    ::: slot
    :::
    ::: source
    :::
    :::
`;

test("the manual's examples lint clean", () => {
  assert.deepEqual(found(MANUAL), []);
});

for (const indent of [4, 6]) {
  const pad = ' '.repeat(indent);
  test(`a literal body, indented ${indent}`, () => {
    const text = [
      'aside:',
      '  class: x',
      '  body: |',
      `${pad}Some text`,
      `${pad}::: inner`,
      `${pad}x`,
      '',
      `${pad}::: open`,
      `${pad}y`,
      '',
    ].join('\n');
    assert.deepEqual(found(text), [
      ['block-in-paragraph', 5, indent + 1, '::: inner'],
      ['unclosed-div', 8, indent + 1, '::: open'],
    ]);
  });
}

test('a quoted body: at its start', () => {
  const text = 'q:\n  body: "a\\n::: d\\nx\\n"\n';
  assert.deepEqual(
    found(text).map(([rule, line, column]) => [rule, line, column]),
    [['block-in-paragraph', 2, 9]],
  );
});

test('what makes it no shortcuts file', () => {
  assert.deepEqual(found(''), []);
  assert.deepEqual(
    found('a: [1\n').map(([rule]) => rule),
    ['yaml-syntax'],
  );
  assert.deepEqual(
    found('- a\n- b\n').map(([rule]) => rule),
    ['shortcut-file'],
  );
  assert.deepEqual(found('n:\n  body: [1, 2]\n'), [
    ['shortcut-body', 2, 9, '[1, 2]'],
  ]);
});
