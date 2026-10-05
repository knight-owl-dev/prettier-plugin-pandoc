// What every tool shares: seeded randomness, the repo it runs against, and
// where failures go for `shrink.mjs` to take.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The repo a tool reads code from: `ROOT` for a baseline worktree, else the
 * one it runs in.
 */
export const ROOT = resolve(
  process.env.ROOT ?? new URL('../..', import.meta.url).pathname,
);

/** A module of the repo under test. */
export const load = (path) => import(resolve(ROOT, path));

/**
 * The tool's positional arguments by name, each with its default.
 *
 * @param {Record<string, string>} defaults
 * @returns {Record<string, string>}
 */
export function args(defaults) {
  const given = process.argv.slice(2);
  return Object.fromEntries(
    Object.entries(defaults).map(([name, value], k) => [
      name,
      given[k] === undefined || given[k] === '' ? value : given[k],
    ]),
  );
}

/**
 * Seeded randomness: the same seed draws the same documents.
 *
 * @param {number} seed
 */
export function random(seed) {
  let state = seed >>> 0;
  const below = (k) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * k);
  };
  return { below, pick: (xs) => xs[below(xs.length)] };
}

/**
 * A fuzzer's failures: each printed while fewer than `show` are, and every
 * one written as a line of `.scratch/fuzz/<name>-<seed>.jsonl`, the cases
 * `shrink.mjs` takes.
 *
 * @param {string} name
 * @param {number} seed
 * @param {number} show
 */
export function failures(name, seed, show) {
  const dir = resolve('.scratch/fuzz');
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${name}-${seed}.jsonl`;
  writeFileSync(file, '');
  const counts = {};
  return {
    file,
    counts,
    /**
     * @param {string} kind
     * @param {object} found The case, as `shrink.mjs` reads it.
     * @param {string} [detail]
     */
    add(kind, found, detail = '') {
      counts[kind] = (counts[kind] ?? 0) + 1;
      appendFileSync(file, `${JSON.stringify({ kind, ...found })}\n`);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total <= show) {
        console.log(`${kind.toUpperCase()} ${JSON.stringify(found)}`);
        if (detail !== '') console.log(`  ${detail}`);
      }
    },
    summary(total, extra = '') {
      const found = Object.entries(counts).map(([k, n]) => `${n} ${k}`);
      const said = found.length === 0 ? 'no failures' : found.join(', ');
      console.log(`${total} cases${extra}: ${said}`);
      if (found.length > 0) console.log(`cases: ${file}`);
    },
  };
}
