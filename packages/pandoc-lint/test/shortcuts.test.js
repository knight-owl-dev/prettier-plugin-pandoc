// Shortcuts files: each template's Markdown linted where it is in the
// YAML, read as Keystone reads it, and what makes the file no shortcuts
// file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintShortcuts } from '../src/index.js';

const found = (text, options) =>
  lintShortcuts('s.yaml', text, options).map((d) => [
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
sic:
  class: container
  span: |
    []{.slot} [[sic]]{.font style="italic"}
ship:
  class: container
  span: |
    HMS []{.font style="italic"}
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

for (const indent of [4, 6]) {
  const pad = ' '.repeat(indent);
  test(`a literal span, indented ${indent}`, () => {
    const text = [
      'sic:',
      '  class: container',
      '  span: |',
      `${pad}[]{.slot} [[sic]]{.font style="italic"},`,
      `${pad}as [the style guide][guide] has it`,
      '',
    ].join('\n');
    assert.deepEqual(found(text), [
      ['undefined-reference', 5, indent + 4, '[the style guide][guide]'],
    ]);
  });
}

test('a body and a span: each linted', () => {
  const text = [
    'sic:',
    '  class: container',
    '  body: |',
    '    [a][b]',
    '  span: |',
    '    [c][d]',
    '',
  ].join('\n');
  assert.deepEqual(
    found(text).map(([rule, line]) => [rule, line]),
    [
      ['undefined-reference', 4],
      ['undefined-reference', 6],
    ],
  );
});

// A template is a fragment: what reads as a document's title, metadata or
// a heading's own identifier is none of those in it.
test('a template read as a fragment', () => {
  const body = (...lines) =>
    ['x:', '  body: |', ...lines.map((l) => (l ? `    ${l}` : '')), ''].join(
      '\n',
    );
  assert.deepEqual(found(body('---', 'title: [unclosed', '---', '', 'a')), []);
  assert.deepEqual(found(body('# Same', '', '# Same {#same}')), []);
  assert.deepEqual(found(body('% A title', '', 'a'), { noMetadata: true }), []);
});

test('a quoted body: at its start, with no frame of lines it lacks', () => {
  const text = 'q:\n  body: "a\\n::: d\\nx\\n"\n';
  assert.deepEqual(
    found(text).map(([rule, line, column]) => [rule, line, column]),
    [['block-in-paragraph', 2, 9]],
  );
  assert.equal(lintShortcuts('s.yaml', text)[0].callouts.verbatim, undefined);
});

// A span is one paragraph: a blank line before the block would split it.
test("a span's misread: escaped, not split", () => {
  const text = [
    'edition:',
    '  span: |',
    '    []{.slot}, the edition of',
    '    1984. A reissue',
    '',
  ].join('\n');
  const [d] = lintShortcuts('s.yaml', text);
  assert.equal(d.rule, 'block-in-paragraph');
  assert.equal(
    d.callouts.remedy,
    'Escape it with a backslash: before its marker, or before the period or parenthesis after its number or letter. A span is one paragraph.',
  );
});

test('an aliased template: linted at its anchor, a finding once', () => {
  const text = [
    'a:',
    '  body: &t |',
    '    [x][nope]',
    'b:',
    '  body: *t',
    'c:',
    '  span: *t',
    '',
  ].join('\n');
  assert.deepEqual(
    found(text).map(([rule, line, column]) => [rule, line, column]),
    [['undefined-reference', 3, 5]],
  );
  assert.deepEqual(found('a:\n  span: &s "[]{.slot}"\nb:\n  span: *s\n'), []);
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
  assert.deepEqual(found('n:\n  span: [1, 2]\n'), [
    ['shortcut-span', 2, 9, '[1, 2]'],
  ]);
});
