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

// An indentation indicator sets the indent: spaces past it are Markdown.
test('a literal span with an indentation indicator', () => {
  for (const header of ['|2', '|2-', '|-2', '\n    |2']) {
    const text = `ind:\n  span: ${header}\n      see [x][nope]\n`;
    const line = header.startsWith('\n') ? 4 : 3;
    assert.deepEqual(found(text), [
      ['undefined-reference', line, 11, '[x][nope]'],
    ]);
  }
});

test('a span on one line, as written: where it is', () => {
  assert.deepEqual(found('s:\n  span: see [x][nope] and more\n'), [
    ['undefined-reference', 2, 13, '[x][nope]'],
  ]);
  assert.deepEqual(found("s:\n  span: '[]{.slot} see [x][nope]'\n"), [
    ['undefined-reference', 2, 24, '[x][nope]'],
  ]);
  assert.deepEqual(found('s:\n  span: "[]{.slot} see [x][nope]"\n'), [
    ['undefined-reference', 2, 24, '[x][nope]'],
  ]);
});

test('an unclosed div: where Pandoc closes it, in the file', () => {
  const literal = 'q:\n  body: |\n    ::: a\n    text\n';
  const [open] = lintShortcuts('s.yaml', literal);
  assert.equal(open.callouts.effect, 'Pandoc closes it at s.yaml:5:1.');
  const quoted = 'q:\n  body: "::: a\\ntext\\n"\n';
  const [pinned] = lintShortcuts('s.yaml', quoted);
  assert.equal(
    pinned.callouts.effect,
    'Pandoc closes it where its template ends.',
  );
});

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

test('a quoted body: each finding, each place it names at its start', () => {
  const two = 'q:\n  body: "a\\n# h1\\n\\nb\\n# h2\\n"\n';
  assert.deepEqual(
    found(two).map(([rule, line, column]) => [rule, line, column]),
    [
      ['block-in-paragraph', 2, 9],
      ['block-in-paragraph', 2, 9],
    ],
  );
  const again = 'q:\n  body: "[a]: /x\\n\\n[a]: /y\\n"\n';
  const [d] = lintShortcuts('s.yaml', again);
  assert.equal(d.rule, 'duplicate-link-reference');
  assert.deepEqual(d.callouts.offenders, ['s.yaml:2:9: [a]: /x']);
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
  // The build reads it as written: text, one edit from a block.
  assert.equal(d.severity, 'warn');
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

// One node, a body and a span: their finding once, with the span's remedy,
// which holds for both.
test('an anchor read as a body and a span: one finding', () => {
  const text = [
    'a:',
    '  body: &t |',
    '    the edition of',
    '    1984. A reissue',
    'b:',
    '  span: *t',
    '',
  ].join('\n');
  const diagnostics = lintShortcuts('s.yaml', text);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].callouts.remedy, /A span is one paragraph/);
});

test('an alias to no anchor: YAML that is not', () => {
  assert.deepEqual(found('x:\n  body: *nope\n'), [
    ['yaml-syntax', 2, 9, '*nope'],
  ]);
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
