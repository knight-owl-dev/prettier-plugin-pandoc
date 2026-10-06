// What a read logs: Pandoc's messages, in its order, each at Pandoc's
// position: `helpers/log.js`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown } from '../src/index.js';
import { logsCompared } from './helpers/log.js';
import { pandocLog, TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'a link reference defined again': '[a]: /a\n[a]: /b\n\n[a]\n',
  'a link reference defined again alike': '[a]: /a\n[a]: /a\n\n[a]\n',
  'a link reference defined again, other attributes':
    '[a]: /a {.x}\n  [a]: /a {.y}\n',
  'a link reference defined again in a list item':
    '- x\n\n  [b]: /b\n  [b]: /c\n',
  'a link reference defined again in a block quote': '> [q]: /q\n> [q]: /r\n',
  'a note defined again': '[^n]: one\n\n[^n]: two\n\nText[^n].\n',
  'notes not used, by label': '[^b]: b\n\n[^a]: a\n\n[^c]: c\n\nUse[^c].\n',
  'a note defined in a list item, not used': '- x\n\n  [^i]: note\n',
  'a note used in a note': '[^a]: See[^b].\n\n[^b]: b\n\nText[^a].\n',
  'an identifier given twice': '# One {#h}\n\n# Two {#h}\n',
  'an identifier given that one was made': '# H\n\n## Other {#h}\n',
  'identifiers made alike': '# H\n\n# H\n',
  'a setext heading identifier given twice': 'A {#x}\n===\n\nB {#x}\n---\n',
  'a div unclosed': '::: d\nopen\n',
  'divs unclosed, nested': '::: a\n::: b\ntext\n',
  'a div unclosed in a list item': '- ::: d\n  text\n\nafter\n',
  'an HTML div unclosed': '<div>\ntext\n',
  'a closed div': '::: d\ntext\n:::\n',
  'YAML keys given again': [
    '---  ',
    'title: a',
    'author:',
    '  - name: x',
    '    name: y',
    '"odd key": 1',
    '"odd key": 2',
    'b2: {c: 1, c: 2}',
    'title: b',
    '"it\'s": 1',
    '"it\'s": 2',
    '_9: 1',
    '_9: 2',
    'é1: 1',
    'é1: 2',
    '...',
    '',
    'Text',
    '',
  ].join('\n'),
  'a macro defined again':
    '\\newcommand{\\a}{x}\n\\newcommand{\\a}{y}\n\\providecommand{\\a}{z}\n\\renewcommand{\\a}{w}\n',
  'an environment defined again':
    '\\newenvironment{e}{a}{b}\n\n\\newenvironment{e}{c}{d}\n',
  'a toggle not defined': 'Text \\iftoggle{zz}{a}{b} and more.\n',
  'a toggle defined':
    '\\newtoggle{t}\n\\toggletrue{t}\n\nText \\iftoggle{t}{a}{b}.\n',
  'unescaped symbols in raw TeX': 'A \\textbf{a & b # c ^ d} e.\n',
  'an enumerate marker skipped':
    '\\begin{enumerate}[zz]\n\\setcounter{enumi}{x}\n\\item a\n\\end{enumerate}\n',
  'raw TeX in a list item': '- \\newcommand{\\b}{x}\n- \\newcommand{\\b}{y}\n',
  'YAML keys merged, then given again':
    '---\nbase: &b {k: 1, k: 2}\nm:\n  <<: *b\n  k: 2\n  k: 3\nn: *b\n---\n',
  'YAML keys given again, two blocks':
    '---\na: 1\na: 2\n---\n\n---\nb: 1\nb: 2\n---\n',
  'YAML keys given again in a block quote': '> ---\n> a: 1\n> a: 2\n> ---\n',
  'tabs before': '-\t::: d\n\n\t\n[a]:\t/a\n[a]:\t/b {#x}\n\n\t# H {#x}\n',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name} (tab stop ${tabStop})`, () => {
      const ours = readMarkdown(text, { tabStop }).log;
      const theirs = pandocLog(text, 'markdown', tabStop);
      assert.deepEqual(...logsCompared(text, tabStop, ours, theirs));
    });
  }
}

// Each message's span, as the source's text it covers.
const SPANS = {
  'a link reference': ['  [a]: /a\n  [a]: /b "t"\n', ['[a]: /b "t"']],
  'a note': [
    '[^n]: one\n\n[^n]: two\n\n    more\n\nx[^n]',
    ['[^n]: two\n\n    more'],
  ],
  'an unused note': ['[^n]: one\n', ['[^n]: one']],
  'an identifier': ['# A {#a}\n\nB {#a}\n---\n', ['B {#a}\n---']],
  'a div': ['::: d\ntext\n', ['::: d\ntext\n']],
  'a YAML key': ['---\na: 1\n"a": 2\n---\n', ['"a"']],
  'YAML in a block quote': ['> ---\n> a: 1\n> a: 2\n> ---\n', ['a']],
  'a macro': [
    '\\newcommand{\\a}{x}\n\\newcommand{\\a}{y}\n',
    ['\\newcommand{\\a}{y}'],
  ],
  'a toggle': ['A \\iftoggle{t}{a}{b} c\n', ['{t}{a}{b}', '{t}{a}{b}']],
  'in a list item': ['- x\n\n  [a]: /a\n  [a]: /b\n', ['[a]: /b']],
};

for (const [name, [text, expected]] of Object.entries(SPANS)) {
  test(`the span of ${name}`, () => {
    const { log } = readMarkdown(text);
    assert.deepEqual(
      log.map((m) => text.slice(m.start, m.end)),
      expected,
    );
  });
}

test('the log stays out of the JSON', () => {
  const doc = readMarkdown('::: d\n');
  assert.deepEqual(Object.keys(doc), ['pandoc-api-version', 'meta', 'blocks']);
  assert.equal(doc.log.length, 1);
});
