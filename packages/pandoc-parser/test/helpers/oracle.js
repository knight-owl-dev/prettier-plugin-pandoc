// Pandoc as the oracle: its AST of a document, which the port's must equal,
// spans left out.
//
// `latex_macros` is off: its expansion rewrites raw TeX and math content,
// which the port leaves as written (#74).

import { spawnSync } from 'node:child_process';

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
  const run = spawnSync('pandoc', args, { input: text, encoding: 'utf8' });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}
