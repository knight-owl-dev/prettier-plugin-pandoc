// The workspace's packaging rules: one version, each pin of pandoc-parser at
// it (tools/release/stamp.sh writes both) and the workspace's copy loaded;
// each package's notices the root's, its tarball only its notices, manifest,
// README and sources, its entry points among them.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
const NOTICES = ['LICENSE', 'NOTICE.md'];
const PACKED = [...NOTICES, 'package.json'];
const PACKABLE = /^(LICENSE|NOTICE\.md|README\.md|package\.json|src\/.+)$/;
// pandoc-parser's alone: the record of the Pandoc it follows.
const UPSTREAM = 'upstream.json';
const ROOT = new URL('../', import.meta.url);

const read = (url) => readFileSync(url, 'utf8');
const json = (url) => JSON.parse(read(url));
const packages = json(new URL('package.json', ROOT)).workspaces.map((dir) => {
  const url = new URL(`${dir}/package.json`, ROOT);
  return { dir, url, manifest: json(url) };
});
const parser = packages.find(({ manifest }) => manifest.name === PARSER);
const { version } = parser.manifest;
const entries = ({ exports, bin }) =>
  [exports, bin]
    .flatMap((field) =>
      typeof field === 'string' ? [field] : Object.values(field ?? {}),
    )
    .map((path) => path.replace(/^\.\//, ''));
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

for (const { dir } of packages) {
  test(`${dir} ships the root's notices`, () => {
    for (const file of NOTICES) {
      const same = readFileSync(new URL(`${dir}/${file}`, ROOT)).equals(
        readFileSync(new URL(file, ROOT)),
      );
      assert.ok(same, `${dir}/${file} is not the root's`);
    }
  });
}

test('each tarball packs its notices, manifest and sources, nothing else', () => {
  const packs = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--dry-run', '--json', '--workspaces', '--no-update-notifier'],
      { cwd: fileURLToPath(ROOT), encoding: 'utf8' },
    ),
  );
  const found = {};
  const clean = {};
  for (const { manifest } of packages) {
    const { name } = manifest;
    const { files = [] } = packs.find((pack) => pack.name === name) ?? {};
    const paths = files.map((f) => f.path);
    const own = name === PARSER ? [UPSTREAM] : [];
    const required = [...PACKED, ...own, ...entries(manifest)];
    found[name] = {
      missing: required.filter((p) => !paths.includes(p)),
      stray: paths.filter((p) => !PACKABLE.test(p) && !own.includes(p)),
    };
    clean[name] = { missing: [], stray: [] };
  }
  assert.deepEqual(found, clean);
});
