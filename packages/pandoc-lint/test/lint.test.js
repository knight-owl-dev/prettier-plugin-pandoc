// The diagnostics of a manuscript of several files: Pandoc's messages, each
// once, in the file Pandoc's names, on the line it names where its position
// is the construct's own.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pandocFiles } from '../../pandoc-parser/test/helpers/oracle.js';
import {
  formatGithub,
  formatJson,
  formatText,
  lint,
  lintSnippet,
} from '../src/index.js';

const MANUSCRIPTS = {
  'definitions across files': [
    '[a]: /a\n\n[^n]: Used.\n',
    'See [a].[^n]\n\n[A]: /b\n\n[^u]: Unused.\n',
  ],
  'a div open to the end': ['::: aside\nOpen.\n', 'More.\n', '# End\n'],
  'an HTML div open': ['<div>\ntext\n', '\n'],
  'identifiers across files': ['# One {#a}\n', '# Two {#a}\n\n# a\n'],
  'metadata in the second file': ['Text.\n', '---\nk: 1\nk: 2\n---\n'],
  'macros and toggles': [
    '\\newcommand{\\x}{1}\n',
    '\\newcommand{\\x}{2}\n\nA \\iftoggle{t}{x}{y} b.\n',
  ],
  'in a list item': ['- x\n\n  [b]: /b\n  [b]: /c\n'],
  'no final newlines': ['[a]: /a', '[a]: /b', '::: d\nx'],
};

// Where Pandoc's position is where the construct starts.
const AT_START = new Set([
  'UnclosedDiv',
  'DuplicateLinkReference',
  'DuplicateNoteReference',
  'NoteDefinedButNotUsed',
  'MacroAlreadyDefined',
]);

for (const [name, texts] of Object.entries(MANUSCRIPTS)) {
  test(name, () => {
    const files = texts.map((text, k) => ({ path: `f${k + 1}.md`, text }));
    const ours = lint(files, { info: true }).map((d) => ({
      rule: d.rule,
      source: d.source,
      line: d.line,
    }));
    const unique = new Map();
    for (const m of pandocFiles(files).log) {
      const { pretty, ...rest } = m;
      unique.set(JSON.stringify(rest), m);
    }
    const theirs = [...unique.values()].map((m) => {
      const at = m.openpos ?? m;
      const exact = AT_START.has(m.type) && !at.source.endsWith('chunk');
      return {
        rule: m.type.replace(/[a-z](?=[A-Z])/g, '$&-').toLowerCase(),
        source: at.source.replace(/_?chunk$/, ''),
        line: exact ? at.line : undefined,
      };
    });
    // Our line, where Pandoc's is exact.
    const exact = (d) =>
      theirs.some((t) => t.rule === d.rule && t.source === d.source && t.line);
    const comparable = ours.map((d) =>
      exact(d) ? d : { ...d, line: undefined },
    );
    const sorted = (xs) => xs.map((x) => JSON.stringify(x)).sort();
    assert.deepEqual(sorted(comparable), sorted(theirs));
  });
}

test('a diagnostic, framed', () => {
  const files = [
    { path: 'a.md', text: '[a]: /a\n' },
    { path: 'b.md', text: 'Text.\n\n  [a]: /b\n' },
  ];
  assert.equal(
    formatText(lint(files)),
    [
      'b.md:3:3: WARN: link reference [a] is defined again',
      '  a.md:1:1: [a]: /a',
      '  │ 3 |   [a]: /b',
      '  │   |   ^^^^^^^',
      '  Links use the last definition.',
      '',
    ].join('\n'),
  );
});

test('a span ends in the file it starts in', () => {
  const files = [
    { path: 'a.md', text: '::: d\ntext\n' },
    { path: 'b.md', text: 'more\n' },
  ];
  const [d] = lint(files);
  assert.deepEqual(
    [d.source, d.line, d.column, d.endLine, d.endColumn, d.callouts.effect],
    ['a.md', 1, 1, 1, 6, 'Pandoc closes it at b.md:2:1.'],
  );
});

test('INFO messages only when asked for', () => {
  const files = [{ path: 'a.md', text: 'A \\textbf{a & b} c.\n' }];
  assert.deepEqual(lint(files), []);
  assert.deepEqual(
    lint(files, { info: true }).map((d) => [d.rule, d.column]),
    [['parsing-unescaped', 13]],
  );
});

test('a snippet placed in its file', () => {
  const body = 'Line one.\n\n::: d\nopen\n';
  const [d] = lintSnippet(body, {
    source: 'shortcuts.yaml',
    line: 7,
    column: 11,
    indent: 6,
  });
  assert.deepEqual(
    [d.source, d.line, d.column, d.callouts.verbatim],
    ['shortcuts.yaml', 9, 7, ['9 | ::: d', '  | ^^^^^']],
  );
});

test('JSON: versioned, the callouts apart from where a diagnostic is', () => {
  const files = [{ path: 'a.md', text: '::: d\n' }];
  const { version, diagnostics } = JSON.parse(formatJson(lint(files)));
  assert.equal(version, 1);
  assert.deepEqual(Object.keys(diagnostics[0]), [
    'rule',
    'severity',
    'source',
    'start',
    'end',
    'line',
    'column',
    'endLine',
    'endColumn',
    'callouts',
  ]);
  assert.equal(diagnostics[0].callouts.problem, 'div is never closed');
});

test('GitHub: a workflow command per diagnostic, escaped', () => {
  const files = [
    { path: 'a,b:c.md', text: '[a]: /a\n[a]: /b\n' },
    { path: 'd.md', text: 'Text\n# Heading\n' },
  ];
  assert.equal(
    formatGithub(lint(files)),
    [
      '::warning file=a%2Cb%3Ac.md,line=2,endLine=2,col=1,endColumn=7,title=duplicate-link-reference::link reference [a] is defined again%0Aa,b:c.md:1:1: [a]: /a%0ALinks use the last definition.',
      '::error file=d.md,line=2,endLine=2,col=1,endColumn=9,title=block-in-paragraph::heading is read as paragraph text%0AA paragraph runs on to the next blank line: a heading on the line after its text is part of it.%0APut a blank line before it; if it is meant as text, escape its first character with a backslash.',
      '',
    ].join('\n'),
  );
});

test('references and notes nothing in the manuscript defines', () => {
  const files = [
    { path: 'a.md', text: '[a][x], [b][], [c], ![i][y] and Text[^n].\n' },
    { path: 'b.md', text: '[^m]: See[^q].\n\nUse[^m].\n\n[x]: /x\n' },
  ];
  assert.deepEqual(
    lint(files).map((d) => [d.rule, d.column, d.callouts.problem]),
    [
      ['undefined-reference', 9, 'reference [b] is not defined'],
      ['undefined-reference', 21, 'reference [y] is not defined'],
      ['undefined-note', 37, 'note [^n] is not defined'],
    ],
  );
});

test('metadata in the Markdown, with noMetadata alone', () => {
  const files = [
    { path: 'a.md', text: '% Title\n\nText.\n' },
    { path: 'b.md', text: 'More.\n\n---\nauthor: B\n...\n' },
  ];
  assert.deepEqual(lint(files), []);
  assert.deepEqual(
    lint(files, { noMetadata: true }).map((d) => [d.rule, d.source, d.line]),
    [
      ['metadata-in-markdown', 'a.md', 1],
      ['metadata-in-markdown', 'b.md', 3],
    ],
  );
  const body = lintSnippet('---\nk: v\n---\n', { noMetadata: true });
  assert.deepEqual(
    body.map((d) => d.rule),
    ['metadata-in-markdown'],
  );
});
