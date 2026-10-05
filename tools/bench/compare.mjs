// Compare two benchmark results from `run.mjs`: each case's time in both,
// and the change from the first to the second.
//
//   node tools/bench/compare.mjs BASE HEAD
//
// BASE and HEAD are labels under `.scratch/bench/` or paths to results.

import { existsSync, readFileSync } from 'node:fs';

const [base, head] = process.argv.slice(2).map((name) => {
  const file = existsSync(name) ? name : `.scratch/bench/${name}.json`;
  return JSON.parse(readFileSync(file, 'utf8'));
});
if (base === undefined || head === undefined) {
  console.error('usage: compare.mjs BASE HEAD');
  process.exit(2);
}

const cell = (s, width) => String(s).padStart(width);
console.log(
  `${'case'.padEnd(44)} ${cell(`${base.label} ${base.commit}`, 18)} ${cell(`${head.label} ${head.commit}`, 18)} ${cell('change', 8)}`,
);
const names = new Set([
  ...Object.keys(base.results),
  ...Object.keys(head.results),
]);
for (const name of names) {
  const a = base.results[name]?.ms;
  const b = head.results[name]?.ms;
  const change =
    a === undefined || b === undefined
      ? ''
      : `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(0)}%`;
  console.log(
    `${name.padEnd(44)} ${cell(a === undefined ? '-' : `${a}ms`, 18)} ${cell(b === undefined ? '-' : `${b}ms`, 18)} ${cell(change, 8)}`,
  );
}
