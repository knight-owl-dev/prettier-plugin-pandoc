#!/usr/bin/env node
// pandoc-lint [--format=text|json|github] [--strict] [--info] [--tab-stop=N] FILE…
//
// Lints the files as one manuscript, read in the order given, as Pandoc
// reads several. Exits 1 on an error, or on any warning with `--strict`;
// 2 on a usage error.

import { readFileSync } from 'node:fs';
import { formatGithub, formatJson, formatText, lint } from './index.js';

const FORMATS = { text: formatText, json: formatJson, github: formatGithub };

const USAGE =
  'usage: pandoc-lint [--format=text|json|github] [--strict] [--info] [--tab-stop=N] FILE...';

const options = { format: 'text', strict: false, info: false, tabStop: 4 };
const paths = [];
for (const arg of process.argv.slice(2)) {
  const [flag, value] = arg.split(/=(.*)/s);
  if (flag === '--format' && Object.hasOwn(FORMATS, value ?? '')) {
    options.format = value;
  } else if (flag === '--strict' && value === undefined) options.strict = true;
  else if (flag === '--info' && value === undefined) options.info = true;
  else if (flag === '--tab-stop' && /^[1-9][0-9]*$/.test(value ?? '')) {
    options.tabStop = Number(value);
  } else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
  else paths.push(arg);
}
if (paths.length === 0) usage('no files given');

const files = [];
for (const path of paths) {
  try {
    files.push({ path, text: readFileSync(path, 'utf8') });
  } catch (e) {
    console.error(`pandoc-lint: cannot read ${path}: ${e.code ?? e.message}`);
    process.exit(2);
  }
}
const diagnostics = lint(files, options);
process.stdout.write(FORMATS[options.format](diagnostics));
const fails = diagnostics.some(
  (d) => d.severity === 'error' || (options.strict && d.severity === 'warn'),
);
process.exit(fails ? 1 : 0);

function usage(problem) {
  console.error(`pandoc-lint: ${problem}\n${USAGE}`);
  process.exit(2);
}
