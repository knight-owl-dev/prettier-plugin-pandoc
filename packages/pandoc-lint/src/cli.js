#!/usr/bin/env node
// pandoc-lint [--format=text|json|github] [--strict] [--info] [--tab-stop=N]
//             [--shortcuts=FILE]... [FILE]...
//
// Lints the files as one manuscript, read in the order given, as Pandoc
// reads several, and each shortcuts file's bodies. Exits 1 on an error,
// or on any warning with `--strict`; 2 on a usage error.

import { readFileSync } from 'node:fs';
import {
  formatGithub,
  formatJson,
  formatText,
  lint,
  lintShortcuts,
} from './index.js';

const FORMATS = { text: formatText, json: formatJson, github: formatGithub };

const USAGE =
  'usage: pandoc-lint [--format=text|json|github] [--strict] [--info] [--tab-stop=N] [--shortcuts=FILE]... [FILE]...';

const options = { format: 'text', strict: false, info: false, tabStop: 4 };
const paths = [];
const shortcuts = [];
for (const arg of process.argv.slice(2)) {
  const [flag, value] = arg.split(/=(.*)/s);
  if (flag === '--format' && Object.hasOwn(FORMATS, value ?? '')) {
    options.format = value;
  } else if (flag === '--strict' && value === undefined) options.strict = true;
  else if (flag === '--info' && value === undefined) options.info = true;
  else if (flag === '--tab-stop' && /^[1-9][0-9]*$/.test(value ?? '')) {
    options.tabStop = Number(value);
  } else if (flag === '--shortcuts' && value) shortcuts.push(value);
  else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
  else paths.push(arg);
}
if (paths.length + shortcuts.length === 0) usage('no files given');

const read = (path) => {
  try {
    return { path, text: readFileSync(path, 'utf8') };
  } catch (e) {
    console.error(`pandoc-lint: cannot read ${path}: ${e.code ?? e.message}`);
    process.exit(2);
  }
};
const diagnostics = [
  ...shortcuts.map(read).flatMap((f) => lintShortcuts(f.path, f.text, options)),
  ...(paths.length > 0 ? lint(paths.map(read), options) : []),
];
process.stdout.write(FORMATS[options.format](diagnostics));
const fails = diagnostics.some(
  (d) => d.severity === 'error' || (options.strict && d.severity === 'warn'),
);
process.exit(fails ? 1 : 0);

function usage(problem) {
  console.error(`pandoc-lint: ${problem}\n${USAGE}`);
  process.exit(2);
}
