// Benchmark pandoc-parser and the plugin: each case's median time over its
// runs, printed and written to `.scratch/bench/<LABEL>.json` for
// `compare.mjs`. ROOT benchmarks another checkout, a baseline worktree;
// the documents always come from this one, so both measure the same input.
// COMMIT names the commit measured; the image has no git to ask.
//
//   node tools/bench/run.mjs [WHAT] [LABEL] [RUNS]
//
// WHAT: parser, plugin or all (default). LABEL names the result (default
// HEAD).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { args, load } from '../lib/run.mjs';

const { what, label, runs } = args({ what: 'all', label: 'HEAD', runs: '5' });
const HERE = new URL('../..', import.meta.url).pathname;

const corpusDir = `${HERE}packages/prettier-plugin-pandoc/test/corpus`;
const corpus = readdirSync(corpusDir, { recursive: true })
  .filter((f) => f.endsWith('.md') && !f.endsWith('README.md'))
  .map((f) => readFileSync(`${corpusDir}/${f}`, 'utf8'))
  .join('\n\n');

const times = (k, part) =>
  Array.from({ length: k }, (_, i) => part(i)).join('\n');
const DOCUMENTS = {
  corpus,
  'corpus x10': Array(10).fill(corpus).join('\n\n'),
  // A read slower per character than x10's is no longer linear.
  'corpus x20': Array(20).fill(corpus).join('\n\n'),
  prose: times(
    3000,
    (i) =>
      `Paragraph ${i} with *emphasis*, a [link](u) and \`code\` that runs on\nfor a second line of ordinary prose.\n\n- an item\n- another\n`,
  ),
  'mid-line environments': times(
    3000,
    (i) =>
      `Para ${i} with \\begin{x}an env\\end{x} and more text here.\n\n\\begin{y}\nblock\n\\end{y}\n`,
  ),
  'command runs': times(
    3000,
    (i) =>
      `\\newpage \\vspace{1em}\n\\section{S ${i}} text after\n\nPara ${i} \\emph{x}.\n`,
  ),
  containers: times(
    3000,
    (i) =>
      `Term ${i}\n: def ${i} with *x*\nlazy\n\n  more ${i}\n\n      code\n\n: second\n  > q\n\n- item ${i}\n  b\n`,
  ),
};

/** The median of `runs` timings of `f`, after one run to warm up. */
async function median(f) {
  await f();
  const ms = [];
  for (let k = 0; k < Number(runs); k++) {
    const start = performance.now();
    await f();
    ms.push(performance.now() - start);
  }
  return ms.sort((a, b) => a - b)[ms.length >> 1];
}

const results = {};
const record = (name, ms, chars) => {
  results[name] = { ms: Math.round(ms * 10) / 10, chars };
  const perChar = ((ms * 1e6) / chars).toFixed(0);
  console.log(
    `${name.padEnd(44)} ${ms.toFixed(1).padStart(9)}ms ${perChar.padStart(6)}ns/char`,
  );
};

if (what === 'parser' || what === 'all') {
  const parser = await load('packages/pandoc-parser/src/index.js');
  // The combinator core alone: a floor, a tokenizer mixing alternatives,
  // and a lookahead on every character.
  const line =
    'Paragraph with **strong** text, a [link](u) and `code` that runs on, ';
  const text = `${line}\n`.repeat(Math.ceil(380_000 / (line.length + 1)));
  const { alt, anyChar, attempt, char, FAIL, letter, lookAhead, many } = parser;
  const { many1, newline, notFollowedBy, oneOf, parse, skipMany, string } =
    parser;
  const twoStars = string('**');
  const peekStars = lookAhead(twoStars);
  const notTick = notFollowedBy(char('`'));
  const CORE = {
    'skipMany anyChar': skipMany(anyChar),
    tokens: many(
      alt(
        many1(letter),
        many1(oneOf(' \t')),
        newline,
        attempt(string('**s')),
        anyChar,
      ),
    ),
    'lookahead per char': skipMany(
      alt(
        (ctx) => (peekStars(ctx) === FAIL ? FAIL : twoStars(ctx)),
        (ctx) => (notTick(ctx) === FAIL ? FAIL : anyChar(ctx)),
        char('`'),
      ),
    ),
  };
  for (const [name, p] of Object.entries(CORE)) {
    record(`core: ${name}`, await median(() => parse(p, text)), text.length);
  }
  for (const [name, doc] of Object.entries(DOCUMENTS)) {
    const ms = await median(() => parser.readMarkdown(doc));
    record(`read: ${name}`, ms, doc.length);
  }
}

if (what === 'plugin' || what === 'all') {
  const plugin = (await load('packages/prettier-plugin-pandoc/src/index.js'))
    .default;
  const format = (doc, proseWrap) =>
    prettier.format(doc, {
      parser: 'markdown',
      plugins: [plugin],
      proseWrap,
    });
  for (const proseWrap of ['preserve', 'always', 'never']) {
    const ms = await median(() => format(corpus, proseWrap));
    record(`format ${proseWrap}: corpus`, ms, corpus.length);
  }
  for (const [name, doc] of Object.entries(DOCUMENTS)) {
    if (name.startsWith('corpus')) continue;
    const part = doc.slice(0, 40_000);
    const ms = await median(() => format(part, 'always'));
    record(`format always: ${name}`, ms, part.length);
  }
}

const commit = process.env.COMMIT ?? 'unknown';
mkdirSync('.scratch/bench', { recursive: true });
const file = `.scratch/bench/${label}.json`;
writeFileSync(file, `${JSON.stringify({ label, commit, results }, null, 2)}\n`);
console.log(`${label} (${commit}): ${file}`);
