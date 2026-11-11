// Hackage packages' sources, each unpacked once into `.scratch/hackage/`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './run.mjs';

export const HACKAGE = join(ROOT, '.scratch/hackage');

/**
 * The directory `id`'s source (`doclayout-0.6`) is unpacked in: whole, or
 * not at all, so a run cut short leaves nothing the next one trusts.
 *
 * @param {string} id
 * @returns {Promise<string>}
 */
export async function unpack(id) {
  const dir = join(HACKAGE, id);
  if (existsSync(dir)) return dir;
  const url = `https://hackage.haskell.org/package/${id}/${id}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const partial = join(HACKAGE, `.${id}`);
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  const input = Buffer.from(await response.arrayBuffer());
  const tar = spawnSync('tar', ['-xzf', '-', '-C', partial], { input });
  if (tar.status !== 0) throw new Error(`${id}: ${tar.stderr}`);
  renameSync(join(partial, id), dir);
  rmSync(partial, { recursive: true });
  return dir;
}
