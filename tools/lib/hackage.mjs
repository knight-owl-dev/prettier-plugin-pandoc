// Hackage packages' sources, each unpacked once into `.scratch/hackage/`,
// its sdist's sha256 kept beside it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './run.mjs';

export const HACKAGE = join(ROOT, '.scratch/hackage');

/**
 * The directory `id`'s source (`doclayout-0.6`) is unpacked in: whole, or
 * not at all, so a run cut short leaves nothing the next one trusts. Where
 * `sha256` is given, the sdist must have it: `upstream.json` records the
 * source the port was reviewed on.
 *
 * @param {string} id
 * @param {string} [sha256]
 * @returns {Promise<string>}
 */
export async function unpack(id, sha256) {
  const dir = join(HACKAGE, id);
  // The digest is written last: without it, the source is not whole.
  if (!existsSync(`${dir}.sha256`)) {
    const url = `https://hackage.haskell.org/package/${id}/${id}.tar.gz`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const input = Buffer.from(await response.arrayBuffer());
    const partial = join(HACKAGE, `.${id}`);
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', '-', '-C', partial], { input });
    if (tar.status !== 0) throw new Error(`${id}: ${tar.stderr}`);
    rmSync(dir, { recursive: true, force: true });
    renameSync(join(partial, id), dir);
    rmSync(partial, { recursive: true });
    const hash = createHash('sha256').update(input).digest('hex');
    writeFileSync(`${dir}.sha256`, hash);
  }
  const found = digest(id);
  if (sha256 !== undefined && found !== sha256) {
    throw new Error(`${id}: sha256 ${found}, upstream.json records ${sha256}`);
  }
  return dir;
}

/**
 * The sha256 of `id`'s sdist, unpacked already.
 *
 * @param {string} id
 */
export const digest = (id) =>
  readFileSync(join(HACKAGE, `${id}.sha256`), 'utf8');
