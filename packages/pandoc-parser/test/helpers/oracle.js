// Pandoc as the oracle: its AST of a document, which the port's must equal,
// spans left out.
//
// `latex_macros` is off: its expansion rewrites raw TeX and math content,
// which the port leaves as written (#74).

import { spawnSync } from 'node:child_process';

// The tab stops every comparison runs at: below, at and above Pandoc's
// default, since each indentation rule moves with it.
export const TAB_STOPS = [2, 4, 8];

const READER = 'markdown-latex_macros';

/**
 * Pandoc's AST of `text`, as its JSON.
 *
 * @param {string} text
 * @param {number} [tabStop]
 * @returns {object}
 */
export function pandocAst(text, tabStop = 4) {
  const args = ['-f', READER, '-t', 'json', `--tab-stop=${tabStop}`];
  return JSON.parse(pandoc(args, text));
}

/**
 * Pandoc's display width of each of `texts`, by doclayout as its Lua API
 * exposes it.
 *
 * @param {string[]} texts
 * @returns {number[]}
 */
export function pandocRealLength(texts) {
  const script =
    'for line in io.lines() do print(pandoc.layout.real_length(line)) end';
  const out = pandoc(['lua', '-e', script], `${texts.join('\n')}\n`);
  return out.trimEnd().split('\n').map(Number);
}

// What Pandoc writes, run with `args` on `input`.
function pandoc(args, input) {
  const options = { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const run = spawnSync('pandoc', args, options);
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  return run.stdout;
}
