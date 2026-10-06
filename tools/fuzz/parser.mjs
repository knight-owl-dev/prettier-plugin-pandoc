// Fuzz pandoc-parser against Pandoc: random documents of one kind
// (`documents.mjs`), each read by both. The reads must be equal, every span
// nested in its parent's, and every container's contents must map each
// child's span in and back out; a Markdown read's log must be Pandoc's.
//
//   node tools/fuzz/parser.mjs [KIND] [N] [SEED] [SHOW] [EXT]
//
// KIND: markdown, containers, raw-tex, yaml (Markdown, at random tab stops),
// latex or latex-tables (EXT: extensions, as `+raw_tex-latex_macros`).

import { comparable, logCli, readAll, readCli } from '../lib/pandoc.mjs';
import { args, failures, load, random } from '../lib/run.mjs';
import * as documents from './documents.mjs';

const { kind, n, seed, show, ext } = args({
  kind: 'markdown',
  n: '1500',
  seed: '1',
  show: '4',
  ext: '',
});
const parser = await load('packages/pandoc-parser/src/index.js');
const { assertNested } = await load(
  'packages/pandoc-parser/test/helpers/spans.js',
);
const { logsCompared } = await load(
  'packages/pandoc-parser/test/helpers/log.js',
);

const GENERATORS = {
  markdown: documents.markdown,
  containers: documents.containers,
  'raw-tex': documents.rawTex,
  yaml: documents.yaml,
  latex: documents.latex,
  'latex-tables': documents.latexTables,
};
const generate = GENERATORS[kind];
if (generate === undefined) {
  console.error(`KIND is one of ${Object.keys(GENERATORS).join(', ')}`);
  process.exit(2);
}
const isLaTeX = kind.startsWith('latex');

const r = random(Number(seed));
const cases = Array.from({ length: Number(n) }, () => ({
  doc: generate(r),
  format: isLaTeX ? `latex${ext}` : 'markdown',
  tabStop: isLaTeX ? 4 : r.pick([2, 4, 8]),
}));

/**
 * The case's read by pandoc-parser, spans left out, as `comparable` gives
 * Pandoc's; and the document, for its spans.
 */
function ours({ doc, tabStop }) {
  try {
    const read = isLaTeX
      ? parser.readLaTeX(doc, {
          extensions: ext.match(/[+-][a-z_]+/g) ?? [],
        })
      : parser.readMarkdown(doc, { tabStop });
    return { read, json: JSON.stringify(parser.withoutSpans(read)) };
  } catch (e) {
    return { read: null, json: `ERROR ${e.message}` };
  }
}

// Each container's children: in order, and mapped into its contents and
// back out to where they start and end.
function contentsFail(value, out = []) {
  if (Array.isArray(value)) {
    const { contents } = value;
    if (contents !== undefined && value.some((b) => b?.t)) {
      let last = 0;
      for (const b of value) {
        if (b?.t === undefined) continue;
        const [from, to] = [
          contents.toInnerStart(b.start),
          contents.toInnerEnd(b.end),
        ];
        const back = [contents.toOuterStart(from), contents.toOuterEnd(to)];
        if (
          from < last ||
          to < from ||
          back[0] !== b.start ||
          back[1] !== b.end
        ) {
          out.push(
            `${b.t} ${b.start}-${b.end} maps to ${from}-${to}, back to ${back}`,
          );
        }
        last = to;
      }
    }
    for (const v of value) contentsFail(v, out);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) contentsFail(v, out);
  }
  return out;
}

const found = failures(`parser-${kind}`, Number(seed), Number(show));
const reads = readAll(
  cases.map(({ doc, ...c }) => ({ text: doc, ...c })),
  { log: true },
);
const wants = reads.map((r) => r?.json ?? null);

// Where our log differs from Pandoc's, Lua's and the CLI's: the first
// messages that differ, as compared, else null.
function logDiffers({ doc, tabStop }, read, log) {
  const differ = (theirs) => {
    const [got, want] = logsCompared(doc, tabStop, read.log, theirs);
    const at = (k) => [JSON.stringify(got[k]), JSON.stringify(want[k])];
    for (let k = 0; k < Math.max(got.length, want.length); k++) {
      const pair = at(k);
      if (pair[0] !== pair[1]) return [`#${k} ${pair[0]}`, `#${k} ${pair[1]}`];
    }
    return null;
  };
  return differ(log) && differ(logCli(doc, { tabStop }));
}
const view = { meta: !isLaTeX };
let errors = 0;
let hangs = 0;
for (const [k, c] of cases.entries()) {
  if (wants[k] === null) {
    hangs++;
    found.add('hang', c);
    continue;
  }
  const want = comparable(wants[k], view);
  if (want === 'ERROR') errors++;
  const { read, json } = ours(c);
  const got = comparable(json, view);
  // Lua's read leaves tabs unexpanded: the CLI confirms.
  if (got !== want && got !== comparable(readCli(c.doc, c), view)) {
    found.add(
      'differ',
      c,
      `pandoc ${want.slice(0, 300)}\n  ours   ${got.slice(0, 300)}`,
    );
    continue;
  }
  if (read === null) continue;
  try {
    assertNested(read.blocks, 0, c.doc.length, 'document');
  } catch (e) {
    found.add('span', c, e.message);
  }
  const mapped = isLaTeX ? [] : contentsFail(read.blocks);
  if (mapped.length > 0) found.add('contents', c, mapped[0]);
  const logged = isLaTeX ? null : logDiffers(c, read, reads[k].log);
  if (logged !== null) {
    const [got, want] = logged.map((l) => l.slice(0, 300));
    found.add('log', c, `pandoc ${want}\n  ours   ${got}`);
  }
}
found.summary(cases.length, ` (${errors} Pandoc errors, ${hangs} hangs)`);
