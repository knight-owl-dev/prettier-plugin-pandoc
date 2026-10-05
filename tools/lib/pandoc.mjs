// Pandoc's reads, for the tools: many documents through one `pandoc lua`
// process, and one through the CLI, which expands tabs before reading as
// the Lua reader does not.

import { spawnSync } from 'node:child_process';

const LUA = `local cases = pandoc.json.decode(io.read('a'))
local out = {}
for i, c in ipairs(cases) do
  local ok, d = pcall(pandoc.read, c.text, c.format, {tab_stop = c.tabStop})
  out[i] = ok and pandoc.write(d, 'json') or ('ERROR ' .. tostring(d))
end
io.write(pandoc.json.encode(out))`;

/**
 * @typedef {object} Read
 * @property {string} text
 * @property {string} [format] A reader with extensions, `latex+raw_tex`.
 * @property {number} [tabStop]
 */

function runLua(cases, seconds) {
  const input = JSON.stringify(
    cases.map(({ text, format = 'markdown', tabStop = 4 }) => ({
      text,
      format,
      tabStop,
    })),
  );
  return spawnSync('pandoc', ['lua', '-e', LUA], {
    input,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    timeout: seconds * 1000,
  });
}

/**
 * Each case's read as Pandoc's JSON, `ERROR …` where reading fails, null
 * where it takes longer than `seconds`: a batch that times out is split
 * until the case that hangs stands alone.
 *
 * @param {Read[]} cases
 * @param {{batch?: number, seconds?: number}} [options]
 * @returns {(string | null)[]}
 */
export function readAll(cases, { batch = 100, seconds = 30 } = {}) {
  const read = (part) => {
    const run = runLua(part, seconds);
    if (run.status === 0) return JSON.parse(run.stdout);
    if (part.length === 1) return [null];
    const half = Math.ceil(part.length / 2);
    return [...read(part.slice(0, half)), ...read(part.slice(half))];
  };
  const out = [];
  for (let i = 0; i < cases.length; i += batch) {
    out.push(...read(cases.slice(i, i + batch)));
  }
  return out;
}

/**
 * The CLI's read of `text` as JSON, or `ERROR …`.
 *
 * @param {string} text
 * @param {{format?: string, tabStop?: number}} [options]
 */
export function readCli(text, { format = 'markdown', tabStop = 4 } = {}) {
  const args = ['-f', format, '-t', 'json', `--tab-stop=${tabStop}`];
  const run = spawnSync('pandoc', args, { input: text, encoding: 'utf8' });
  return run.status === 0 ? run.stdout : `ERROR ${run.stderr.trim()}`;
}

/**
 * The CLI's native rendering of `text`, for reading by eye.
 *
 * @param {string} text
 * @param {{format?: string, tabStop?: number}} [options]
 */
export function nativeCli(text, { format = 'markdown', tabStop = 4 } = {}) {
  const args = ['-f', format, '-t', 'native', `--tab-stop=${tabStop}`];
  const run = spawnSync('pandoc', args, { input: text, encoding: 'utf8' });
  return run.status === 0 ? run.stdout : `ERROR ${run.stderr.trim()}`;
}

/**
 * A read to compare: its blocks, and its metadata where `meta`, soft breaks
 * as spaces where `soft`, and code in a language `sample` names by its
 * attributes alone, prettier's to lay out. `ERROR` for a read that failed.
 *
 * @param {string | null} json
 * @param {{meta?: boolean, soft?: boolean, sample?: (language: string) => boolean}} [options]
 */
export function comparable(json, { meta = false, soft = false, sample } = {}) {
  if (json === null) return 'HANG';
  if (json.startsWith('ERROR')) return 'ERROR';
  const doc = JSON.parse(json, (_, v) => {
    if (soft && v?.t === 'SoftBreak') return { t: 'Space' };
    const language = v?.t === 'CodeBlock' ? v.c[0][1][0] : undefined;
    if (language !== undefined && sample?.(language)) {
      return { t: 'CodeBlock', c: [v.c[0]] };
    }
    return v;
  });
  return JSON.stringify(meta ? [doc.meta, doc.blocks] : doc.blocks);
}
