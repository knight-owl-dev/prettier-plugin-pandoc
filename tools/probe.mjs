// Probe a document: Pandoc's read at tab stops 2, 4 and 8, and whether
// pandoc-parser's is the same; where it differs, both and where they part.
// With spans, each block of pandoc-parser's read with the source it spans,
// and each container's contents as the reader read them.
//
//   node tools/probe.mjs [FILE] [FORMAT] [SPANS]
//
// FILE defaults to standard input; FORMAT to markdown (or latex, with
// extensions as `latex+raw_tex`); SPANS is 1 to show spans.

import { readFileSync } from 'node:fs';
import { comparable, nativeCli, readCli } from './lib/pandoc.mjs';
import { args, load } from './lib/run.mjs';

const { file, format, spans } = args({
  file: '',
  format: 'markdown',
  spans: '',
});
const text = readFileSync(file === '' ? 0 : file, 'utf8');
const parser = await load('packages/pandoc-parser/src/index.js');
const isLaTeX = format.startsWith('latex');

const ours = (tabStop) => {
  try {
    const extensions = format.match(/[+-][a-z_]+/g) ?? [];
    const read = isLaTeX
      ? parser.readLaTeX(text, { extensions })
      : parser.readMarkdown(text, { tabStop });
    return { read, json: JSON.stringify(parser.withoutSpans(read)) };
  } catch (e) {
    return { read: null, json: `ERROR ${e.message}` };
  }
};

// Where two strings first part.
const parting = (a, b) => {
  let k = 0;
  while (k < a.length && a[k] === b[k]) k++;
  return k;
};

const show = (s) => JSON.stringify(s);
const BLOCKS = new Set([
  ...['Plain', 'Para', 'LineBlock', 'CodeBlock', 'RawBlock', 'BlockQuote'],
  ...['OrderedList', 'BulletList', 'DefinitionList', 'Header'],
  ...['HorizontalRule', 'Table', 'Figure', 'Div'],
]);

// The lists of blocks directly under a block: a quote's, each item's or
// definition's, a div's.
function blockLists(value, out = []) {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((x) => BLOCKS.has(x?.t))) {
      out.push(value);
    } else {
      for (const v of value) blockLists(v, out);
    }
  }
  return out;
}

function outline(blocks, depth = 0) {
  const pad = '  '.repeat(depth);
  for (const b of blocks) {
    console.log(
      `${pad}${b.t} ${b.start}-${b.end} ${show(text.slice(b.start, b.end))}`,
    );
    if (b.t === 'Para' || b.t === 'Plain' || b.t === 'Header') continue;
    for (const list of blockLists(b.c)) {
      if (list.contents !== undefined) {
        const indent =
          list.indent === undefined ? '' : `, indent ${list.indent}`;
        console.log(`${pad}  contents ${show(list.contents.text)}${indent}`);
      }
      outline(list, depth + 2);
    }
  }
}

const stops = isLaTeX ? [4] : [2, 4, 8];
const natives = stops.map((tabStop) => nativeCli(text, { format, tabStop }));
const same = natives.every((n) => n === natives[0]);
for (const [k, tabStop] of stops.entries()) {
  if (k === 0 || !same) {
    const label = same
      ? 'pandoc (every tab stop)'
      : `pandoc, tab stop ${tabStop}`;
    console.log(`${label}:\n${natives[k]}`);
  }
  const view = { meta: !isLaTeX };
  const want = comparable(readCli(text, { format, tabStop }), view);
  const { read, json } = ours(tabStop);
  const got = comparable(json, view);
  if (want === got) {
    console.log(`tab stop ${tabStop}: pandoc-parser reads the same`);
  } else {
    const at = parting(want, got);
    console.log(`tab stop ${tabStop}: pandoc-parser differs at ${at}`);
    console.log(`  pandoc ...${want.slice(Math.max(0, at - 80), at + 200)}`);
    console.log(`  ours   ...${got.slice(Math.max(0, at - 80), at + 200)}`);
  }
  if (spans === '1' && read !== null && (k === 0 || !same)) {
    outline(read.blocks);
  }
}
