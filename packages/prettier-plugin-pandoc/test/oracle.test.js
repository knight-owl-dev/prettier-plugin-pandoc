// The oracle: formatting must not change what Pandoc reads.
//
// Each corpus file is formatted, and Pandoc parses it before and after. The
// two parses must match, soft breaks read as spaces — where a line wraps is the
// one thing formatting may change. Pandoc is the reader under test, so the
// suite needs it on PATH; the test image carries a pinned one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as prettier from 'prettier';
import plugin from '../src/index.js';

const CORPUS = new URL('./corpus/', import.meta.url);

// Constructs the plugin does not handle yet. Each runs, reported as todo, so
// the day one starts passing is visible in the output.
const TODO = new Set([]);

const BASE = {
  parser: 'markdown',
  plugins: [plugin],
  proseWrap: 'always',
};

// Block rules do not depend on width, and the sweep is what shows it: a narrow
// width wraps the most, so it lands the most words at the start of a line.
const WIDTHS = [40, 80, 120];

// Both ways a fenced sample can be printed: reformatted by its tag, or as
// written.
const EMBEDDED = ['auto', 'off'];

// Below, at and above Pandoc's default: every indentation rule moves with the
// tab stop, and prettier's own parser reads at four whatever Pandoc is set to.
const TAB_STOPS = [2, 4, 8];

// Every combination of the three, for each corpus file.
const CONFIGURATIONS = WIDTHS.flatMap((printWidth) =>
  EMBEDDED.flatMap((embedded) =>
    TAB_STOPS.map((tabStop) => ({ printWidth, embedded, tabStop })),
  ),
);

// Pandoc's parse, soft breaks read as spaces. With embedded formatting on,
// prettier formats a sample by its tag: in a markdown one what must hold is
// what Pandoc reads, and in any other tagged one the code is prettier's to
// lay out. With it off, and for an untagged sample either way, the sample
// prints as written and is compared as such.
function pandoc(text, { samples, tabStop }) {
  const args = ['-f', 'markdown', '-t', 'json', `--tab-stop=${tabStop}`];
  const run = spawnSync('pandoc', args, { input: text, encoding: 'utf8' });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  return JSON.parse(run.stdout, (_, value) => {
    if (value?.t === 'SoftBreak') return { t: 'Space' };
    if (samples === 'by-meaning' && value?.t === 'CodeBlock') {
      const [attr, code] = value.c;
      const tags = attr[1];
      if (tags.includes('markdown')) {
        const read = pandoc(code, { samples, tabStop }).blocks;
        return { t: 'CodeBlock', c: [attr, read] };
      }
      if (tags.length > 0) return { t: 'CodeBlock', c: [attr] };
    }
    return value;
  });
}

// Every markdown file under the corpus, a directory's README aside.
const corpus = readdirSync(CORPUS, { recursive: true }).filter(
  (f) => f.endsWith('.md') && !f.endsWith('README.md'),
);

for (const name of corpus) {
  const text = readFileSync(new URL(name, CORPUS), 'utf8');

  for (const { printWidth, embedded, tabStop } of CONFIGURATIONS) {
    const options = {
      ...BASE,
      printWidth,
      embeddedLanguageFormatting: embedded,
      pandocTabStop: tabStop,
    };
    const label = `${name} (width ${printWidth}, embedded ${embedded}, tab stop ${tabStop})`;
    const todo = TODO.has(name) || TODO.has(`${name}:${embedded}`);
    const read = {
      samples: embedded === 'auto' ? 'by-meaning' : 'as-written',
      tabStop,
    };

    test(`${label}: Pandoc reads the formatted file as the source`, {
      todo,
    }, async () => {
      const formatted = await prettier.format(text, options);
      assert.deepEqual(pandoc(formatted, read), pandoc(text, read));
    });

    test(`${label}: formatting twice changes nothing`, { todo }, async () => {
      const once = await prettier.format(text, options);
      assert.equal(await prettier.format(once, options), once);
    });
  }
}
