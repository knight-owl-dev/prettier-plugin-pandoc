// The plugin's snapshots, `test/expected/<mode>/<file>`: the output aimed at
// for each corpus file, at width 80 and tab stop 4.
//
//   node tools/snapshots.mjs diff [KEY...]   the current output against each
//   node tools/snapshots.mjs write [KEY...]  each made the current output
//
// A KEY is `always/divs.md`; none means every snapshot. `diff` writes the
// current output under `.scratch/snapshots/` and prints a unified diff per
// snapshot it differs from.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as prettier from 'prettier';
import { load, ROOT } from './lib/run.mjs';

const [action, ...given] = process.argv.slice(2);
if (action !== 'diff' && action !== 'write') {
  console.error('usage: snapshots.mjs diff|write [KEY...]');
  process.exit(2);
}
const plugin = (await load('packages/prettier-plugin-pandoc/src/index.js'))
  .default;
const test = `${ROOT}/packages/prettier-plugin-pandoc/test`;
const corpus = readdirSync(`${test}/corpus`, { recursive: true }).filter(
  (f) => f.endsWith('.md') && !f.endsWith('README.md'),
);
// As expected.test.js sets each mode.
const MODES = {
  preserve: { proseWrap: 'preserve' },
  always: { proseWrap: 'always' },
  'tab-width-4': { proseWrap: 'always', tabWidth: 4 },
};
const keys =
  given.length > 0
    ? given
    : Object.keys(MODES).flatMap((mode) => corpus.map((f) => `${mode}/${f}`));

let differs = 0;
for (const key of keys) {
  const [mode, ...name] = key.split('/');
  const source = readFileSync(`${test}/corpus/${name.join('/')}`, 'utf8');
  const output = await prettier.format(source, {
    parser: 'markdown',
    plugins: [plugin],
    ...MODES[mode],
    printWidth: 80,
    pandocTabStop: 4,
  });
  const expected = `${test}/expected/${key}`;
  const target = action === 'write' ? expected : `.scratch/snapshots/${key}`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
  if (action === 'diff') {
    const run = spawnSync('diff', ['-u', expected, target], {
      encoding: 'utf8',
    });
    if (run.status !== 0) {
      differs++;
      process.stdout.write(run.stdout);
    }
  }
}
console.log(
  action === 'write'
    ? `${keys.length} snapshots written`
    : `${differs} of ${keys.length} snapshots differ`,
);
