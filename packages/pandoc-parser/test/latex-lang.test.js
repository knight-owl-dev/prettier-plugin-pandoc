// Languages and translated terms in LaTeX, read as Pandoc reads them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex'];

const CASES = {
  'terms in English by default': '\\proofname, \\figurename, \\seename.',
  'the default language set':
    '\\setdefaultlanguage{french}\\proofname \\setmainlanguage[variant=british]{english}\\tablename',
  'a language with no data, then one by its script':
    '\\setdefaultlanguage{coptic}\\proofname \\setdefaultlanguage{serbianc}\\proofname',
  'a language polyglossia does not know':
    '\\setdefaultlanguage{klingon}\\proofname',
  "norsk, whose data is Norwegian Bokmål's":
    '\\setdefaultlanguage{norsk}\\proofname',
  'babel environments':
    '\\begin{german}\\proofname\\end{german}\n\n\\begin{otherlanguage}{french}Bonjour.\\end{otherlanguage}\n\n\\begin{otherlanguage}[x]{klingon}Q\\end{otherlanguage}',
  'inline languages':
    '\\foreignlanguage{french}{oui} \\foreignlanguage{klingon}{x} \\textfrench{ bonjour } \\textgerman[variant=swiss]{hoi} \\textarabic[locale = algeria]{x} \\textgreek[variant=poly]{y}',
  quotes:
    '\\enquote{a \\enquote{b} c} \\enquote*{d} \\foreignquote{french}{e} \\hyphenquote*{german}{f} \\enquote[x]{g}',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const ext of VARIANTS) {
    test(`${name}: Pandoc's AST (latex${ext})`, () => {
      const extensions = ext.match(/[+-][a-z_]+/g) ?? [];
      assert.deepEqual(
        withoutSpans(readLaTeX(text, { extensions })),
        pandocLaTeXAst(text, ext),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    assertNested(readLaTeX(text).blocks, 0, text.length, 'document');
  });
}

for (const lang of ['fr', 'pt-BR', 'zh-Hant-TW', 'sr-Latn', 'xx', '!']) {
  test(`terms translated to ${lang}, as -M lang gives it`, () => {
    const text = '\\proofname, \\figurename';
    assert.deepEqual(
      withoutSpans(readLaTeX(text, { lang })).blocks,
      pandocLaTeXAst(text, '', [`--metadata=lang:${lang}`]).blocks,
    );
  });
}
