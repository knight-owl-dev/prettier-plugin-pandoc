// What the LaTeX reader reads outside the text, through its host's hooks:
// files, images and the date, as Pandoc reads them where the files are.

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { SYNTAXES } from '../src/skylighting/syntaxes.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex'];

// Each case: the files beside the document, and the document.
const CASES = {
  input: [{ 'a.tex': 'Included \\emph{text}.\n' }, 'Before \\input{a} after.'],
  include: [{ 'a.tex': 'Inc.\n' }, '\\include{a}\n\nNext.'],
  'an input with its extension': [{ 'b.txt': 'Plain.\n' }, '\\input{b.txt}'],
  'an input missing': [{}, 'x \\input{missing} y'],
  'several inputs': [{ 'a.tex': '\\section{From a}\n' }, '\\input{a,b}'],
  subfile: [{ 's.tex': 'Sub \\textbf{file}.\n' }, '\\subfile{s}'],
  'a package': [
    { 'mypkg.sty': '\\newcommand{\\foo}{FOO}\n', 'p.sty': '\\def\\x#1{<#1>}' },
    '\\usepackage{mypkg}\\usepackage[opt]{p,q}\n\\foo \\x{y}',
  ],
  images: [
    { 'img.png': 'x', 'dir/pic.PDF': 'x' },
    '\\includegraphics{img} \\includegraphics[width=0.5\\textwidth,height=2cm,alt=Alt]{img2} \\includesvg{dir/pic} \\includegraphics{"q.jpg"}',
  ],
  inputminted: [
    { 'code.py': 'print(1)\r\n' },
    '\\inputminted[linenos=true]{python}{code.py}',
  ],
  graphicspath: [{}, '\\graphicspath{{figs/}{img/}} text'],
  'endinput in a file': [{ 'a.tex': 'A \\endinput B\nC\n' }, '\\input{a} D'],
  listings: [
    {
      'code.py': 'print(1)\nprint(2)\nprint(3)\n',
      'x.hs': 'main = 1\n',
      'f.none': 'a\n',
      Makefile: 'all:\n',
      'c.h': 'int\n',
    },
    '\\lstinputlisting{code.py}\n\\lstinputlisting[language=Haskell]{x.hs}\n\\lstinputlisting[firstline=2,lastline=3,numbers=left,label=l]{code.py}\n\\lstinputlisting[firstline=3]{code.py} \\lstinputlisting[lastline=0]{code.py}\n\\lstinputlisting{f.none}\n\\lstinputlisting{Makefile}\n\\lstinputlisting{c.h}\n\\lstinputlisting{"missing.js"}',
  ],
  'filecontents input': [
    {},
    '\\begin{filecontents}{x.tex}\nFrom filecontents.\n\\end{filecontents}\n\\input{x}',
  ],
};

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// A directory holding `files`, and a host reading from it.
function where(files) {
  const dir = mkdtempSync(join(tmpdir(), 'latex-io-'));
  dirs.push(dir);
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), t);
  }
  const host = {
    readFile: (p) => {
      try {
        return readFileSync(join(dir, p), 'utf8');
      } catch {
        return null;
      }
    },
    fileExists: (p) => existsSync(join(dir, p)),
  };
  return { dir, host };
}

for (const [name, [files, text]] of Object.entries(CASES)) {
  const { dir, host } = where(files);
  for (const ext of VARIANTS) {
    test(`${name}: Pandoc's AST (latex${ext})`, () => {
      const extensions = ext === '' ? [] : [ext];
      assert.deepEqual(
        withoutSpans(readLaTeX(text, { host, extensions })),
        pandocLaTeXAst(text, ext, [], dir),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readLaTeX(text, { host }).blocks, 0, text.length, 'document');
  });
}

test("listings' languages by extension, each of skylighting's", () => {
  const exts = [
    ...new Set(
      SYNTAXES.flatMap(([, globs]) => globs)
        .filter((g) => /^\*\.[A-Za-z0-9_+-]+$/.test(g))
        .map((g) => g.slice(1)),
    ),
  ];
  const files = Object.fromEntries(exts.map((e) => [`f${e}`, 'x\n']));
  const { dir, host } = where(files);
  const text = exts.map((e) => `\\lstinputlisting{f${e}}`).join('\n');
  assert.deepEqual(
    withoutSpans(readLaTeX(text, { host })),
    pandocLaTeXAst(text, '', [], dir),
  );
});

test('the date, as the clock gives it', () => {
  const text = '\\today';
  assert.deepEqual(withoutSpans(readLaTeX(text)), pandocLaTeXAst(text));
  const now = () => new Date(2024, 1, 3);
  const [{ c: inlines }] = readLaTeX(text, { host: { now } }).blocks;
  assert.equal(inlines[0].c, '2024-02-03');
});

test('no host: no file exists', () => {
  const [{ c: inlines }] = readLaTeX(
    'a \\input{a} \\includegraphics{x}',
  ).blocks;
  assert.deepEqual(
    withoutSpans(inlines).map((x) => x.t),
    ['Str', 'Space', 'Image'],
  );
});

test('spans: an included file spans nothing, where it is read in', () => {
  const { host } = where({ 'a.tex': 'one two' });
  const text = 'x \\input{a} y';
  const [{ c: inlines }] = readLaTeX(text, { host }).blocks;
  const included = inlines.filter((x) => x.c === 'one' || x.c === 'two');
  assert.equal(included.length, 2);
  assert.ok(included.every((x) => x.start === 11 && x.end === 11));
});
