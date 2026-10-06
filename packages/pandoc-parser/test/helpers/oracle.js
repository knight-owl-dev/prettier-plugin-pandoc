// Pandoc as the oracle: its AST of a document, which the port's must equal,
// spans left out. Each format reads with Pandoc's default extensions.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The tab stops every comparison runs at: below, at and above Pandoc's
// default, since each indentation rule moves with it.
export const TAB_STOPS = [2, 4, 8];

/**
 * Pandoc's AST of `text`, as its JSON.
 *
 * @param {string} text
 * @param {number} [tabStop]
 * @returns {object}
 */
export function pandocAst(text, tabStop = 4) {
  const args = ['-f', 'markdown', '-t', 'json', `--tab-stop=${tabStop}`];
  return JSON.parse(pandoc(args, text));
}

/**
 * Pandoc's AST of `text` read as LaTeX, its extensions changed by `ext`
 * (`+raw_tex`, …), as its JSON; `args` passed to Pandoc too, run in `cwd`.
 *
 * @param {string} text
 * @param {string} [ext]
 * @param {string[]} [args]
 * @param {string} [cwd]
 * @returns {object}
 */
export function pandocLaTeXAst(text, ext = '', args = [], cwd = undefined) {
  const flags = ['-f', `latex${ext}`, '-t', 'json', ...args];
  return JSON.parse(pandoc(flags, text, cwd));
}

/**
 * What Pandoc logs reading `text` from `format`: its `--log` JSON.
 *
 * @param {string} text
 * @param {string} [format]
 * @param {number} [tabStop]
 * @returns {object[]}
 */
export function pandocLog(text, format = 'markdown', tabStop = 4) {
  const dir = mkdtempSync(join(tmpdir(), 'log-'));
  const log = join(dir, 'log.json');
  try {
    const args = ['-f', format, '-t', 'json', `--tab-stop=${tabStop}`];
    pandoc([...args, `--log=${log}`], text);
    return JSON.parse(readFileSync(log, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true });
  }
}

/**
 * Pandoc's AST and log of `files`, read together as its CLI reads several,
 * at `tabStop`.
 *
 * @param {{path: string, text: string}[]} files
 * @param {number} [tabStop]
 * @returns {{ast: object, log: object[]}}
 */
export function pandocFiles(files, tabStop = 4) {
  const dir = mkdtempSync(join(tmpdir(), 'files-'));
  try {
    for (const { path, text } of files) writeFileSync(join(dir, path), text);
    const args = ['-f', 'markdown', '-t', 'json', `--tab-stop=${tabStop}`];
    const paths = files.map((f) => f.path);
    const out = pandoc([...args, '--log=log.json', ...paths], '', dir);
    const log = JSON.parse(readFileSync(join(dir, 'log.json'), 'utf8'));
    return { ast: JSON.parse(out), log };
  } finally {
    rmSync(dir, { recursive: true });
  }
}

/**
 * Pandoc's AST of `files`, read together as its CLI reads several.
 *
 * @param {{path: string, text: string}[]} files
 * @returns {object}
 */
export const pandocFilesAst = (files) => pandocFiles(files).ast;

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

// What Pandoc writes, run with `args` on `input`, in `cwd`.
function pandoc(args, input, cwd) {
  const options = { input, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const run = spawnSync('pandoc', args, options);
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  return run.stdout;
}
