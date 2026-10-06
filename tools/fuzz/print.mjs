// Fuzz the plugin against Pandoc: random Markdown (`documents.mjs`) at
// random tab stops, tab widths, widths and `proseWrap`. Pandoc must read each output as its
// source, soft breaks as spaces, and a second format must change nothing.
//
//   node tools/fuzz/print.mjs [N] [SEED] [SHOW]

import * as prettier from 'prettier';
import { comparable, readAll, readCli } from '../lib/pandoc.mjs';
import { args, failures, load, random } from '../lib/run.mjs';
import { markdown } from './documents.mjs';

const { n, seed, show } = args({ n: '1500', seed: '1', show: '4' });
const plugin = (await load('packages/prettier-plugin-pandoc/src/index.js'))
  .default;

const r = random(Number(seed));
const cases = Array.from({ length: Number(n) }, () => {
  const { pick } = r;
  return {
    doc: markdown(r),
    tabStop: pick([2, 4, 8]),
    tabWidth: pick([2, 4, 8]),
    proseWrap: pick(['always', 'always', 'never', 'preserve']),
    printWidth: pick([10, 20, 40, 80]),
    embeddedLanguageFormatting: pick(['auto', 'off']),
  };
});

const found = failures('print', Number(seed), Number(show));
const formatted = [];
let changed = 0;
for (const c of cases) {
  const options = {
    parser: 'markdown',
    plugins: [plugin],
    pandocTabStop: c.tabStop,
    tabWidth: c.tabWidth,
    proseWrap: c.proseWrap,
    printWidth: c.printWidth,
    embeddedLanguageFormatting: c.embeddedLanguageFormatting,
  };
  let once;
  try {
    once = await prettier.format(c.doc, options);
  } catch {
    // Pandoc fails these too, as the read of each output shows.
    formatted.push(c.doc);
    continue;
  }
  formatted.push(once);
  if (once !== c.doc) changed++;
  const twice = await prettier.format(once, options);
  if (twice !== once) found.add('unstable', c, JSON.stringify(twice));
}

const read = (texts) =>
  readAll(texts.map((text, k) => ({ text, tabStop: cases[k].tabStop })));
const before = read(cases.map((c) => c.doc));
const after = read(formatted);
// The languages prettier formats a sample in, by name, alias or extension.
const { languages } = await prettier.getSupportInfo();
const names = new Set(
  languages.flatMap((l) => [
    l.name.toLowerCase(),
    ...(l.aliases ?? []),
    ...(l.extensions ?? []).map((e) => e.slice(1)),
  ]),
);
for (const [k, c] of cases.entries()) {
  const formats = c.embeddedLanguageFormatting === 'auto';
  const soft = {
    meta: true,
    soft: true,
    sample: (language) => formats && names.has(language.toLowerCase()),
  };
  if (comparable(before[k], soft) === comparable(after[k], soft)) continue;
  // Lua's read leaves tabs unexpanded: the CLI confirms.
  const cli = (text) => comparable(readCli(text, c), soft);
  if (cli(c.doc) !== cli(formatted[k])) {
    found.add('misread', c, JSON.stringify(formatted[k]));
  }
}
found.summary(cases.length, `, ${changed} changed`);
