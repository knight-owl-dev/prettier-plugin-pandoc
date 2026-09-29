// Pandoc as the tests' oracle: its parse of a document, at a tab stop.

import { spawnSync } from 'node:child_process';

// The tab stops every comparison runs at: below, at and above Pandoc's
// default, since each indentation rule moves with it.
export const TAB_STOPS = [2, 4, 8];

/**
 * Pandoc's JSON parse of `text`, as a string for the caller to read.
 *
 * @param {string} text
 * @param {number} tabStop
 * @returns {string}
 */
export function readPandoc(text, tabStop) {
  const args = ['-f', 'markdown', '-t', 'json', `--tab-stop=${tabStop}`];
  const run = spawnSync('pandoc', args, { input: text, encoding: 'utf8' });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  return run.stdout;
}
