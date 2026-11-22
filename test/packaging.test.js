// The workspace's packaging rules, which tools/release/stamp.sh writes: one
// version, each pin of pandoc-parser at it, and the workspace's copy loaded.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PARSER = '@knight-owl-llc/pandoc-parser';
const FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const ROOT = new URL('../', import.meta.url);

const json = (url) => JSON.parse(readFileSync(url, 'utf8'));
const packages = json(new URL('package.json', ROOT)).workspaces.map((dir) => {
  const url = new URL(`${dir}/package.json`, ROOT);
  return { dir, url, manifest: json(url) };
});
const parser = packages.find(({ manifest }) => manifest.name === PARSER);
const { version } = parser.manifest;
const pins = ({ manifest }) =>
  FIELDS.filter((field) => PARSER in (manifest[field] ?? {})).map((field) => [
    field,
    manifest[field][PARSER],
  ]);

test('the packages share one version', () => {
  for (const { dir, manifest } of packages) {
    assert.equal(manifest.version, version, dir);
  }
});

test("each pin of pandoc-parser is the packages' version", () => {
  for (const pkg of packages) {
    for (const [field, pin] of pins(pkg)) {
      assert.equal(pin, version, `${pkg.dir} ${field}`);
    }
  }
});

const own = fileURLToPath(
  new URL(parser.manifest.exports['.'], new URL(`${parser.dir}/`, ROOT)),
);
for (const pkg of packages.filter((pkg) => pins(pkg).length > 0)) {
  test(`${pkg.dir} loads the workspace's pandoc-parser`, () => {
    assert.equal(createRequire(pkg.url).resolve(PARSER), own);
  });
}
