// Shrink a fuzzer's failure to the smallest document that still fails the
// same way: lines dropped, then words, then characters, while it does.
//
//   node tools/shrink.mjs CASES [LINE]
//
// CASES is a `.jsonl` file the fuzzers write; LINE picks its case (1 by
// default). Prints the shrunk case, a line `make shrink` takes again, and
// what fails.

import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { comparable, logCli, nativeCli, readCli } from './lib/pandoc.mjs';
import { args, load } from './lib/run.mjs';

const { file, line } = args({ file: '', line: '1' });
if (file === '') {
  console.error('usage: shrink.mjs CASES [LINE]');
  process.exit(2);
}
const found = JSON.parse(
  readFileSync(file, 'utf8').split('\n').filter(Boolean)[Number(line) - 1],
);
const plugin = (await load('packages/prettier-plugin-pandoc/src/index.js'))
  .default;
const parser = await load('packages/pandoc-parser/src/index.js');
const { assertNested } = await load(
  'packages/pandoc-parser/test/helpers/spans.js',
);
const { logsCompared } = await load(
  'packages/pandoc-parser/test/helpers/log.js',
);

// Formatted samples compare by their attributes, as the fuzzer compares them.
const formats = found.embeddedLanguageFormatting === 'auto';
const format = (doc) =>
  prettier.format(doc, {
    parser: 'markdown',
    plugins: [plugin],
    pandocTabStop: found.tabStop,
    tabWidth: found.tabWidth,
    proseWrap: found.proseWrap,
    printWidth: found.printWidth,
    embeddedLanguageFormatting: found.embeddedLanguageFormatting,
  });

const isLaTeX = found.format?.startsWith('latex');
const ours = (doc) => {
  const extensions = found.format?.match(/[+-][a-z_]+/g) ?? [];
  return isLaTeX
    ? parser.readLaTeX(doc, { extensions })
    : parser.readMarkdown(doc, { tabStop: found.tabStop });
};
const view = { meta: !isLaTeX };
const pandoc = (doc) => comparable(readCli(doc, found), view);
const mine = (doc) => {
  try {
    return comparable(JSON.stringify(parser.withoutSpans(ours(doc))), view);
  } catch {
    return 'ERROR';
  }
};

// Whether `doc` fails as the case did; a document that fails otherwise,
// format or read throwing, does not.
const FAILS = {
  async unstable(doc) {
    const once = await format(doc);
    return (await format(once)) !== once;
  },
  async misread(doc) {
    const soft = { meta: true, soft: true, sample: () => formats };
    const read = (text) => comparable(readCli(text, found), soft);
    const source = read(doc);
    return source !== 'ERROR' && source !== read(await format(doc));
  },
  differ: (doc) => pandoc(doc) !== mine(doc),
  log(doc) {
    const theirs = logCli(doc, found);
    const pair = logsCompared(doc, found.tabStop, ours(doc).log, theirs);
    return JSON.stringify(pair[0]) !== JSON.stringify(pair[1]);
  },
  span(doc) {
    try {
      assertNested(ours(doc).blocks, 0, doc.length, 'document');
      return false;
    } catch {
      return true;
    }
  },
};
const fails = async (doc) => {
  try {
    return await FAILS[found.kind](doc);
  } catch {
    return false;
  }
};
if (FAILS[found.kind] === undefined) {
  console.error(`no shrinking for ${found.kind} yet`);
  process.exit(2);
}
if (!(await fails(found.doc))) {
  console.log('the case no longer fails');
  process.exit(0);
}

// The document with each piece dropped in turn, while one still fails.
async function drop(doc, split) {
  let pieces = split(doc);
  for (let k = 0; k < pieces.length; ) {
    const fewer = [...pieces.slice(0, k), ...pieces.slice(k + 1)];
    if (await fails(fewer.join(''))) pieces = fewer;
    else k++;
  }
  return pieces.join('');
}
const LINES = (doc) => doc.split(/(?<=\n)/);
const WORDS = (doc) => doc.split(/(?<=[ \n])/);
const CHARS = (doc) => [...doc];

let doc = found.doc;
for (let before = ''; before !== doc; ) {
  before = doc;
  for (const split of [LINES, WORDS, CHARS]) doc = await drop(doc, split);
}

const shrunk = { ...found, doc };
console.log(JSON.stringify(shrunk));
console.log(`source  ${JSON.stringify(doc)}`);
if (found.kind === 'unstable' || found.kind === 'misread') {
  const once = await format(doc);
  console.log(`once    ${JSON.stringify(once)}`);
  console.log(`twice   ${JSON.stringify(await format(once))}`);
  if (found.kind === 'misread') {
    console.log(`pandoc  ${nativeCli(doc, found)}`);
    console.log(`after   ${nativeCli(once, found)}`);
  }
} else {
  console.log(`pandoc  ${pandoc(doc)}`);
  console.log(`ours    ${mine(doc)}`);
}
