// The port follows the Pandoc the oracle runs, as `upstream.json` records:
// reviewed on its release, each library at the version it links, every
// module a port names (`@see`) listed. A Pandoc bump fails here until the
// port is reviewed on it: docs/bumping-pandoc.md.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { API_VERSION } from '../src/ast/nodes.js';
import { pandocLinks, pandocVersion } from './helpers/oracle.js';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const upstream = JSON.parse(
  readFileSync(join(PACKAGE, 'upstream.json'), 'utf8'),
);
const SOP = 'see docs/bumping-pandoc.md';

const SRC = join(PACKAGE, 'src');
const sources = readdirSync(SRC, { recursive: true })
  .filter((f) => f.endsWith('.js'))
  .map((f) => join(SRC, f));

test('the port was reviewed on the Pandoc the oracle runs', () => {
  const runs = pandocVersion();
  assert.equal(
    runs,
    upstream.pandoc.release,
    `the oracle runs Pandoc ${runs}, the port was reviewed on ${upstream.pandoc.release}: ${SOP}`,
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

// GHC alone has no sdist on Hackage.
test("each source reviewed is named by its sdist's sha256", () => {
  const sources = [
    ['pandoc', upstream.pandoc],
    ...Object.entries(upstream.libraries).filter(([name]) => name !== 'ghc'),
  ];
  const unnamed = sources.filter(([, s]) => !/^[0-9a-f]{64}$/.test(s.sha256));
  assert.deepEqual(
    unnamed.map(([name]) => name),
    [],
    SOP,
  );
});

test('the AST carries the pandoc-types version the port follows', () => {
  assert.equal(
    API_VERSION.join('.'),
    upstream.libraries['pandoc-types'].version,
  );
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
  for (const file of sources) {
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
