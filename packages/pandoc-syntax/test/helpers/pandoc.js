// Pandoc as the tests' oracle: its parse of a document, at a tab stop.
//
// A verdict is asked at test time, so a Pandoc that changes its mind fails a
// test instead of drifting from what an assertion once recorded.

import { spawn, spawnSync } from 'node:child_process';

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

// Pandoc's JSON parse of each of `texts`, one run each, a few at a time.
const PARALLEL = 16;

function readPandocAsync(text) {
  return new Promise((resolve, reject) => {
    const run = spawn('pandoc', ['-f', 'markdown', '-t', 'json']);
    let out = '';
    run.stdout.on('data', (chunk) => {
      out += chunk;
    });
    run.on('error', reject);
    run.on('close', () => resolve(out));
    run.stdin.end(text);
  });
}

/**
 * Pandoc's JSON parse of each text, one run each: a raw block can swallow any
 * separator between texts sharing a run.
 *
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
export async function readPandocEach(texts) {
  const read = [];
  for (let i = 0; i < texts.length; i += PARALLEL) {
    read.push(
      ...(await Promise.all(texts.slice(i, i + PARALLEL).map(readPandocAsync))),
    );
  }
  return read;
}

/**
 * The text of each raw TeX block in Pandoc's JSON parse.
 *
 * @param {string} json
 * @returns {string[]}
 */
export function rawBlocksOf(json) {
  const found = [];
  JSON.parse(json, (_, value) => {
    if (value?.t === 'RawBlock') found.push(value.c[1]);
    return value;
  });
  return found;
}
