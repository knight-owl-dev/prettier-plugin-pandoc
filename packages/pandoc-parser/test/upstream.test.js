// The port follows the Pandoc the oracle runs, as `upstream.json` records:
// reviewed on its release, each library at the version it links, every
// module a port names (`@see`) listed. A Pandoc bump fails here until the
// port is reviewed on it: docs/bumping-pandoc.md.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pandocLinks, pandocVersion } from './helpers/oracle.js';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const upstream = JSON.parse(
  readFileSync(join(PACKAGE, 'upstream.json'), 'utf8'),
);
const SOP = 'see docs/bumping-pandoc.md';

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });

test('the port was reviewed on the Pandoc the oracle runs', () => {
  const runs = pandocVersion();
  assert.equal(
    runs,
    upstream.pandoc,
    `the oracle runs Pandoc ${runs}, the port was reviewed on ${upstream.pandoc}: ${SOP}`,
  );
});

test('each library at the version the oracle links', () => {
  const libraries = Object.entries(upstream.libraries);
  const links = pandocLinks(libraries.map(([name]) => name));
  const moved = libraries
    .filter(([name, { version }]) => links.get(name).join() !== version)
    .map(([name, { version }]) => {
      const linked = links.get(name).join(', ') || 'none';
      return `${name}: the port follows ${version}, the oracle links ${linked}`;
    });
  assert.deepEqual(moved, [], `${moved.join('; ')}: ${SOP}`);
});

// A target falls under the longest listed module it starts with: past it, a
// type or function.
test('every module a port names is listed, each listed one named', () => {
  const listed = [
    ...Object.keys(upstream.modules),
    ...Object.values(upstream.libraries).flatMap((l) => l.modules),
  ];
  const named = new Set();
  const unlisted = new Set();
  for (const file of sources(join(PACKAGE, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const [, target] of text.matchAll(/@see +`?([A-Z]\w*(?:\.\w+)+)/g)) {
      const module = listed
        .filter((m) => target === m || target.startsWith(`${m}.`))
        .sort((a, b) => b.length - a.length)[0];
      if (module) named.add(module);
      else unlisted.add(target);
    }
  }
  assert.deepEqual([...unlisted], [], 'named, not in upstream.json');
  assert.deepEqual(
    listed.filter((m) => !named.has(m)),
    [],
    'in upstream.json, never named',
  );
});
