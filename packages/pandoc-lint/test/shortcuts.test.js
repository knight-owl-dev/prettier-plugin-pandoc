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

// A template is read alone: its references are defined in it, quoted as
// its YAML writes them.
test("a template's undefined reference and note: defined in it", () => {
  const callouts = (text) =>
    lintShortcuts('s.yaml', text).map((d) => [
      d.callouts.remedy,
      d.callouts.see,
    ]);
  const see =
    'https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#how-a-template-is-read';
  assert.deepEqual(callouts('r:\n  span: |\n    see [this][ref]\n'), [
    [
      'Define it in the template: a blank line, then [ref]: followed by its target.',
      see,
    ],
  ]);
  assert.deepEqual(callouts('n:\n  body: |\n    a claim[^src]\n'), [
    [
      'Define it in the template: a blank line, then [^src]: followed by its text.',
      see,
    ],
  ]);
  assert.deepEqual(callouts('q:\n  span: "see [x][a\\\\_b]"\n'), [
    [
      'Define it in the template: a blank line, then [a\\\\_b]: followed by its target.',
      see,
    ],
  ]);
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
// a heading's own identifier is none of those in it, and no reference finds
// a heading by its text.
test('a template read as a fragment', () => {
  const body = (...lines) =>
    ['x:', '  body: |', ...lines.map((l) => (l ? `    ${l}` : '')), ''].join(
      '\n',
    );
  assert.deepEqual(found(body('---', 'title: [unclosed', '---', '', 'a')), []);
  assert.deepEqual(found(body('# Same', '', '# Same {#same}')), []);
  assert.deepEqual(found(body('% A title', '', 'a'), { noMetadata: true }), []);
  for (const [heading, see, rules] of [
    ['# Legend', 'See [Legend][].', ['undefined-reference']],
    ['# Legend', 'See [the key][Legend].', ['undefined-reference']],
    ['# Legend {#legend}', 'See [Legend][].', ['undefined-reference']],
    ['# Legend', 'See [Legend].', []],
  ]) {
    assert.deepEqual(
      found(body(heading, '', see)).map(([rule]) => rule),
      rules,
      see,
    );
  }
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
    'A span is one paragraph: write 1984\\. instead.',
  );
});

// A remedy quotes Markdown as the file writes it: a double-quoted
// scalar's backslash twice.
test("a remedy's backslash, as the template's YAML writes it", () => {
  const remedy = (text) =>
    lintShortcuts('s.yaml', text).find((d) => d.rule === 'block-in-paragraph')
      .callouts.remedy;
  assert.match(remedy('q:\n  body: "a\\n::: d\\nx\\n"\n'), /write \\\\::: /);
  assert.match(
    remedy("q:\n  body: 'a\n\n    ::: d\n\n    x'\n"),
    /write \\::: /,
  );
  assert.match(remedy('q:\n  body: |\n    a\n    ::: d\n'), /write \\::: /);
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

// More than one document: keystone reads the first that isn't a null, and
// refuses a second that holds anything, a written null too, reported at
// its start.
// https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#the-file
test('a second document: the file refused, at its start', () => {
  assert.deepEqual(found('g:\n  class: font\n---\n~\n'), [
    ['shortcut-file', 3, 1, '---'],
  ]);
  assert.deepEqual(found('g:\n  class: font\n--- !foo\n'), [
    ['shortcut-file', 3, 1, '--- !foo'],
  ]);
  assert.deepEqual(
    found('~\n---\ng:\n  class: ~\n').map(([rule, line]) => [rule, line]),
    [
      ['shortcut-file', 2],
      ['shortcut-null', 4],
    ],
  );
  const [d] = lintShortcuts('s.yaml', 'g: {}\n---\nh: {}\n');
  assert.deepEqual(d.callouts, {
    problem: 'shortcuts file holds more than one YAML document',
    because: 'A shortcuts file is one map of names to definitions.',
    remedy:
      'Merge the documents into one map, and delete any that is only a null.',
    verbatim: ['2 | ---', '  | ^^^'],
  });
});

test('a directive with no document: YAML that is not', () => {
  assert.deepEqual(
    found('%YAML 1.2\n').map(([rule]) => rule),
    ['yaml-syntax'],
  );
});

test('a shortcut that is no map: the file refused', () => {
  assert.deepEqual(found('g: 1\nh: [a]\ni: text\n'), [
    ['shortcut-file', 1, 4, '1'],
    ['shortcut-file', 2, 4, '[a]'],
    ['shortcut-file', 3, 4, 'text'],
  ]);
  assert.equal(
    lintShortcuts('s.yaml', 'g: 1\n')[0].callouts.problem,
    "shortcut 'g' is not a map",
  );
});

test('a document of nothing, or comments alone: no second', () => {
  assert.deepEqual(found('g:\n  class: font\n---\n'), []);
  assert.deepEqual(found('---\n# notes\n---\ng:\n  class: font\n'), []);
});

test('a file only a null: no map of shortcuts', () => {
  const [d] = lintShortcuts('s.yaml', '~\n');
  assert.equal(d.rule, 'shortcut-file');
  assert.equal(
    d.callouts.problem,
    "shortcuts file isn't a map of names to definitions",
  );
});

// Each: a file, and its repeated and complex keys, where each is written.
const KEYS = {
  'a shortcut written again': [
    'g:\n  class: font\ng:\n  class: align\n',
    [['shortcut-duplicate-key', 3, 1, 'g', 'key g is written again']],
  ],
  'a field written again': [
    'g:\n  class: font\n  class: align\n',
    [['shortcut-duplicate-key', 3, 3, 'class', 'key g.class is written again']],
  ],
  'a number and its text': [
    'g:\n  interface:\n    1: a\n    "1": b\n',
    [
      [
        'shortcut-duplicate-key',
        4,
        5,
        '"1"',
        'key g.interface.1 is written again',
      ],
    ],
  ],
  'each repeat after the first': [
    'g: {}\ng: {}\ng: {}\n',
    [
      ['shortcut-duplicate-key', 2, 1, 'g', 'key g is written again'],
      ['shortcut-duplicate-key', 3, 1, 'g', 'key g is written again'],
    ],
  ],
  "a list item's": [
    'g:\n  classes:\n    - a: 1\n      a: 2\n',
    [
      [
        'shortcut-duplicate-key',
        4,
        7,
        'a',
        'key g.classes[1].a is written again',
      ],
    ],
  ],
  'a key an alias writes': [
    'g:\n  &k class: font\n  *k : align\n',
    [['shortcut-duplicate-key', 3, 3, '*k', 'key g.*k is written again']],
  ],
  '~ and null: apart': ['g:\n  ~: 1\n  null: 2\n', []],
  'a merge key and "<<": apart': ['g:\n  <<: {}\n  "<<": 2\n', []],
  'an empty key, at its colon': [
    'a:\n  : x\n  : y\n',
    [['shortcut-duplicate-key', 3, 3, ':', 'key a."" is written again']],
  ],
  'a list as a key': [
    '? [a, b]\n: class: font\n',
    [['shortcut-complex-key', 1, 3, '[a, b]', 'a list is used as a key']],
  ],
  'a map as a key, in a shortcut': [
    'g:\n  ? {a: 1}\n  : x\n',
    [['shortcut-complex-key', 2, 5, '{a: 1}', 'a map is used as a key in g']],
  ],
  'an alias to a map as a key': [
    'a: &m {x: 1}\n*m : y\n',
    [['shortcut-complex-key', 2, 1, '*m', 'a map is used as a key']],
  ],
};

for (const [name, [text, expected]] of Object.entries(KEYS)) {
  test(`a key: ${name}`, () => {
    const keys = lintShortcuts('s.yaml', text).filter((d) =>
      ['shortcut-duplicate-key', 'shortcut-complex-key'].includes(d.rule),
    );
    assert.deepEqual(
      keys.map((d) => [
        d.rule,
        d.line,
        d.column,
        text.slice(d.start, d.end),
        d.callouts.problem,
      ]),
      expected,
    );
  });
}

test("a repeated key's callouts: where it was first written", () => {
  const [d] = lintShortcuts('s.yaml', 'g:\n  class: font\n  class: align\n');
  assert.deepEqual(d.callouts, {
    problem: 'key g.class is written again',
    offenders: ['s.yaml:2:3: class: font'],
    because: 'A map holds each key once.',
    remedy: 'Delete all but one.',
    verbatim: ['3 |   class: align', '  |   ^^^^^'],
  });
});

// Keystone drops a complex key and all it holds, an alias's to a map too.
test('what a complex key holds: nothing read', () => {
  const rules = (text) => found(text).map(([rule]) => rule);
  assert.deepEqual(rules('? [a]\n: ~\n'), ['shortcut-complex-key']);
  assert.deepEqual(rules('a: &m {x: 1}\n*m : ~\n'), ['shortcut-complex-key']);
  assert.deepEqual(rules('? [a]\n: body: "[x][nope]"\n'), [
    'shortcut-complex-key',
  ]);
});

test('an alias key to no anchor: YAML that is not', () => {
  assert.deepEqual(found('g:\n  *nope : x\n'), [
    ['yaml-syntax', 2, 3, '*nope'],
  ]);
});

test("a repeated key's offender: its line, no carriage return", () => {
  const [d] = lintShortcuts('s.yaml', 'g:\r\n  class: a\r\n  class: b\r\n');
  assert.deepEqual(d.callouts.offenders, ['s.yaml:2:3: class: a']);
});

// A layer only overrides: a null anywhere stops keystone's build, each
// reported at the key that holds it, or the list item it is.
// https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#shadowing-a-system-shortcut
const NULLS = {
  'a shortcut': ['a: ~\n', [1, 1, 'a: ~', 'a has no value']],
  'its class': ['a:\n  class: ~\n', [2, 3, 'class: ~', 'a.class has no value']],
  'its content': [
    'a:\n  class: font\n  content: ~\n',
    [3, 3, 'content: ~', 'a.content has no value'],
  ],
  'its span': [
    'a:\n  class: font\n  span: ~\n',
    [3, 3, 'span: ~', 'a.span has no value'],
  ],
  'an interface entry': [
    'a:\n  class: font\n  interface:\n    family: ~\n',
    [4, 5, 'family: ~', 'a.interface.family has no value'],
  ],
  "an entry's field": [
    'a:\n  class: font\n  interface:\n    family:\n      default: ~\n',
    [5, 7, 'default: ~', 'a.interface.family.default has no value'],
  ],
  'an empty value': ['a:\n  body:\n', [2, 3, 'body:', 'a.body has no value']],
  'the word null': [
    'a:\n  class: Null\n',
    [2, 3, 'class: Null', 'a.class has no value'],
  ],
  'a custom tag on no value': [
    'a:\n  class: !foo\n',
    [2, 3, 'class: !foo', 'a.class has no value'],
  ],
  'a custom tag on no value, a list item': [
    'a:\n  classes:\n    - x\n    - !foo\n',
    [4, 5, '- !foo', 'a.classes[2] has no value'],
  ],
  'a list item, counted from 1': [
    'a:\n  classes: [x, ~]\n',
    [2, 16, '~', 'a.classes[2] has no value'],
  ],
  'an empty item of a block list, at its dash': [
    'a:\n  classes:\n    - x\n    -\n',
    [4, 5, '-', 'a.classes[2] has no value'],
  ],
  'an alias to one: where it is written': [
    'n: &n ~\nb:\n  class: *n\n',
    [1, 1, 'n: &n ~', 'n has no value'],
  ],
  'one under a key written as null': [
    '~:\n  body: ~\n',
    [2, 3, 'body: ~', '~.body has no value'],
  ],
  'one under a key that reads as a path': [
    'a.b:\n  "[1]": ~\n',
    [2, 3, '"[1]": ~', '"a.b"."[1]" has no value'],
  ],
};

// A core tag's empty value is text, and a tag on a value is that value.
test('a tag that is no null', () => {
  assert.deepEqual(
    found('a:\n  class: !!str\n  content: !foo slot\n  body: !foo ""\n'),
    [],
  );
});

test('a file only a custom tag: no map of shortcuts', () => {
  assert.deepEqual(found('!foo\n'), [['shortcut-file', 1, 1, '!foo']]);
});

test('a key written as null: a key, not a null', () => {
  assert.deepEqual(found('~:\n  class: x\n'), []);
  assert.deepEqual(found('a:\n  : x\n'), []);
});

for (const [name, [text, ...expected]] of Object.entries(NULLS)) {
  test(`a null: ${name}`, () => {
    const nulls = lintShortcuts('s.yaml', text).filter(
      (d) => d.rule === 'shortcut-null',
    );
    assert.deepEqual(
      nulls.map((d) => [
        d.line,
        d.column,
        text.slice(d.start, d.end),
        d.callouts.problem,
      ]),
      expected,
    );
    assert.ok(nulls.every((d) => d.severity === 'error'));
  });
}

test('a null template: a null, not a template that is no text', () => {
  assert.deepEqual(
    found('a:\n  body: ~\n  span: ~\n').map(([rule]) => rule),
    ['shortcut-null', 'shortcut-null'],
  );
  assert.deepEqual(
    found('a:\n  span: [1, ~]\n').map(([rule]) => rule),
    ['shortcut-span', 'shortcut-null'],
  );
});

test("a null's callouts: why, and what to write instead", () => {
  const [d] = lintShortcuts('s.yaml', 'a:\n  interface:\n    family: ~\n');
  assert.deepEqual(d.callouts, {
    problem: 'a.interface.family has no value',
    because:
      'A layer only overrides: a null removes nothing, and stops the build.',
    remedy:
      'Give it a value, or delete the key. To reach a state a default excludes, write the value that names it.',
    verbatim: ['3 |     family: ~', '  |     ^^^^^^^^^'],
  });
});
