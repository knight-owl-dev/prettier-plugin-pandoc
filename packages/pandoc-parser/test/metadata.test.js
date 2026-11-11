// Metadata in Markdown, read as Pandoc reads it: the title block, and YAML
// blocks decoded as yamlet decodes them, their values read again.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PandocParseError, readMarkdown, withoutSpans } from '../src/index.js';
import { pandocAst, TAB_STOPS } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const yaml = (body) => `---\n${body}\n...\n\nBody.`;

// Aliases to aliases, ten each, `depth` deep.
const laughs = (depth) => {
  const list = (x) => `[${Array(10).fill(x).join(', ')}]`;
  const lines = Array.from({ length: depth }, (_, i) => {
    return `l${i + 1}: &l${i + 1} ${list(`*l${i}`)}`;
  });
  return [`l0: &l0 ${list('lol')}`, ...lines].join('\n');
};

const CASES = {
  'a title block':
    '% The *Title*\n% A. One; B. Two\n  C. Three\n% 2024\n\nBody.',
  'a title block, title and date': '% Title\n%\n% Date\n\nBody.',
  'a title on two lines': '% A long\n  title\n\nBody.',
  'a percent sign later': 'Body.\n\n% not a title',
  booleans: yaml(
    'a: yes\nb: No\nc: ON\nd: y\ne: N\nf: off\ng: True\nh: TRUE\ni: tRue',
  ),
  nulls: yaml('a: null\nb: Null\nc: ~\nd:\ne: NULL'),
  numbers: yaml(
    'a: 1\nb: 1.0\nc: 1.50\nd: 0.05\ne: 1e-3\nf: -2\ng: +3\nh: 0x1F\ni: 0o17\nj: 12345678.5\nk: 1e30\nl: .5\nm: 1_000\nn: 190:20:30\no: 5.\np: 1e1000\nq: -1e-1000\nr: 0e5000',
  ),
  'numbers YAML 1.2 reads as text': yaml(
    'a: -0x1F\nb: +0o7\nc: 0X1F\nd: 0b101\ne: 1e\nf: .\ng: 1.2.3',
  ),
  'infinities, NaN and zeros': yaml(
    'a: .inf\nb: -.Inf\nc: +.INF\nd: .nan\ne: .NaN\nf: -.nan\ng: -0.0\nh: 0.0\ni: -0\nj: .0e5',
  ),
  'quoted, tagged and block scalars': yaml(
    'a: "yes"\nb: \'1\'\nc: !!str true\nd: >\n  true\ne: |-\n  true\nf: |\n  line one\n\n  line two\ng: !!int 5',
  ),
  'tags of the core schema and others': yaml(
    'a: !!int "12"\nb: !!float 1\nc: !!bool "true"\nd: !!null ""\ne: !foo 12\nf: ! 12\ng: !!binary aGk=\nh: !foo [b]\ni: !foo {j: 1}\nk: !!map {l: 1}\nm: !<tag:yaml.org,2002:str> 1e1001\nn: !!set {x, y}\no: !!omap [{x: 1}]\np: !!timestamp 2024-01-01',
  ),
  'merge keys as ordinary keys, and hidden keys': yaml(
    'base: &b {x: 1, y: 2}\nm:\n  <<: *b\n  y: 3\nl:\n  <<: [{p: 1}, {p: 2, q: 3}]\nhidden_: x',
  ),
  'aliases within the limit': yaml(laughs(3)),
  aliases: yaml(
    'a: &x [b, &y {c: d}]\ne: *x\nf: *y\ng: &x z\nh: *x\ni: &n [&n m, *n]',
  ),
  'nested values': yaml(
    'list: [a, "*b*", [c]]\nmap:\n  k: v\n  n:\n    - 1\n    - two',
  ),
  'values read as Markdown': yaml(
    'title: A *title* with `code`\nmulti: a long\n  plain value\nnote: Text[^1]\nlink: "[x](u)"',
  ).replace('Body.', 'Body.\n\n[^1]: The note.'),
  'blocks later in the document':
    'First.\n\n---\na: 1\n---\n\nMiddle.\n\n---\na: 2\nb: 3\n...\n\nEnd.',
  'a title block and YAML':
    '% Title\n% Author\n\n---\nauthor: Other\n...\n\nBody.',
  'comments only': '---\n# just a comment\n...\n\nBody.',
  'a rule, not a block': '---\n\nBody.\n\n---\n',
  'a list, not metadata': '---\n- a\n- b\n---\n\nBody.',
  'a root folded scalar at column 0, not metadata': '---\n>\nx\n---\n\nBody.',
  'a root literal scalar at column 0, not metadata':
    '---\n|\n\nx\n---\n\nBody.',
  'a root scalar at column 0 in a list item': '+ ---\n>\n  }\n  ---\n',
  'a root block scalar indented a column': '---\n>\n x\n---\n\nBody.',
  'flow collections closed further in': yaml(
    'a: [\n b,\n ]\nc:\n  d: {e: 1,\n   f: 2\n   }',
  ),
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name}: Pandoc's AST (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        withoutSpans(readMarkdown(text, { tabStop })),
        pandocAst(text, tabStop),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readMarkdown(text).blocks, 0, text.length, 'document');
  });
}

test("an unclosed flow sequence fails the read, as it does Pandoc's", () => {
  const text = '---\na: [b\n...\n\nBody.';
  assert.throws(() => pandocAst(text), /pandoc failed/);
  assert.throws(() => readMarkdown(text), PandocParseError);
});

// Pandoc's first error decoding YAML: its line and column, and the message
// after them.
function pandocFailure(text) {
  try {
    pandocAst(text);
  } catch (e) {
    const at = /Error parsing YAML metadata at .*\n.*?:(\d+):(\d+): (.*)$/m;
    const m = at.exec(e.message);
    if (m) return { line: Number(m[1]), column: Number(m[2]), message: m[3] };
    throw e;
  }
  assert.fail('Pandoc reads it');
}

// The port's alike, from where its span starts.
function failure(text) {
  try {
    readMarkdown(text);
  } catch (e) {
    if (!(e instanceof PandocParseError)) throw e;
    const before = text.slice(0, e.start);
    return {
      line: before.split('\n').length,
      column: e.start - before.lastIndexOf('\n'),
      message: e.message.replace(/^Error parsing YAML metadata: /, ''),
    };
  }
  assert.fail('the port reads it');
}

// Documents yamlet fails: each the first failure, as Pandoc reports it.
const DECODING = {
  'aliases past the limit': laughs(4),
  'a key given again': 'a: 1\nb: 2\na: 3',
  'a key given again, nested':
    'title: a\nauthor:\n  - name: x\n    name: y\ntitle: b',
  'keys of one value': 'a: 1\n0x10: x\n16: y',
  'keys of one float': '1.0: a\n1.00: b',
  'keys of NaN': '.nan: a\n.NaN: b',
  'keys of null': '~: a\nnull: b',
  'empty keys': ': a\n: b',
  'collection keys of one value': '? [a]\n: 1\n? [a]\n: 2',
  'an alias key of the same value': '&a a: b\n*a : c',
  'a merge key given again': '<<: {x: 1}\n<<: {y: 2}',
  'keys of one text': '1: x\n"1": y',
  'keys of one text, then a collection key': '1: x\n"1": y\n[a]: z',
  'a collection key, then keys of one text': '[a]: z\n1: x\n"1": y',
  'an alias key of a mapping': 'a: &x {b: 1}\n*x : 2',
  "a value failing before its mapping's key given again": 'a: 1\na: !!int x',
  'an undefined alias': 'a: *nope',
  'an alias in what it names': 'a: &a [b, *a]',
  'an invalid integer': 'a: !!int abc',
  'an empty integer': 'a: !!int\nb: 1',
  'a YAML 1.1 boolean': 'a: &x !!bool yes',
  'an invalid float': 'a: !!float x',
  'a sequence tag on a scalar': 'a: !!seq x',
  'a scalar tag on a sequence': 'a: !!str [b]',
  'a mapping tag on a sequence': 'a: !!map [b]',
  'an exponent too large': 'a: 1e1001',
  'an exponent too small': 'a: -0.001e-999',
  'an exponent too large, tagged': 'a: !!float 1e1001',
  'a path of keys quoted': '"a.b":\n  "c d": !!int x\n"?e":\n  é: [1]',
  'a path of a key escaped': '"a\\tb": !!int x',
  'a path through an alias key': 'a: &k b\n*k :\n  c: !!int x',
  'a mapping closed too far left': 'c: {x: 1\n}',
  'a sequence closed too far left': 'a:\n  - [b,\n  ]',
  'an explicit key closed too far left': '? [a,\n]\n: b',
  'a failure in the second document': 'a: 1\n--- *x',
};

for (const [name, body] of Object.entries(DECODING)) {
  test(`${name}: Pandoc's failure`, () => {
    const text = `Text.\n\n---\n${body}\n...\n`;
    assert.deepEqual(failure(text), pandocFailure(text));
  });
}

// In a container, Pandoc's column is the YAML's.
test("a key given again in a block quote: Pandoc's line and message", () => {
  const text = '> ---\n> a: 1\n> a: 2\n> ---\n';
  const { column, ...ours } = failure(text);
  const { column: _, ...theirs } = pandocFailure(text);
  assert.deepEqual(ours, theirs);
  assert.equal(column, 3);
});

// Where a parse error spans in the source: what fails, through a
// container's prefixes and a tab.
const FAILING = {
  'an unclosed flow sequence': ['---\na: [b\n...\n\nBody.', '...'],
  'an unknown alias in a quote': ['> ---\n> a: *x\n> ---\n', '*x'],
  'after a tab in a list item': ['+ ---\n\ta: [b\n  ---\n', '---\n'],
};

test('a parse error in a value read again spans its block', () => {
  const text = 'Text.\n\n---\na: |\n  ---\n  b: *x\n  ---\n---\n';
  assert.throws(
    () => readMarkdown(text),
    (e) => e.start === text.indexOf('---') && e.end === e.start,
  );
});

for (const [name, [text, at]] of Object.entries(FAILING)) {
  test(`a parse error spans what fails: ${name}`, () => {
    assert.throws(
      () => readMarkdown(text),
      (e) => e.start === text.lastIndexOf(at),
    );
  });
}

test('spans: a title spans its text after the percent sign', () => {
  const text = '% The Title\n\nBody.';
  const { meta } = readMarkdown(text);
  const [first] = meta.title.c;
  assert.equal(text.slice(first.start, first.end), 'The');
});
