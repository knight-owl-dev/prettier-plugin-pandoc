// What moved upstream between the Pandoc the port was reviewed on
// (`upstream.json`) and the one the oracle runs: each ported module's diff,
// each followed library's at the version the new binary links, Pandoc's
// dependencies added and dropped, and its changelog between the two. Sources
// come from Hackage. Writes `.scratch/pandoc-<to>/`; its README.md is the
// summary the review in docs/bumping-pandoc.md starts from.
//
//   node tools/drift.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, ROOT } from './lib/run.mjs';

const { pandocLinks, pandocVersion } = await load(
  'packages/pandoc-parser/test/helpers/oracle.js',
);
const upstream = JSON.parse(
  readFileSync(join(ROOT, 'packages/pandoc-parser/upstream.json'), 'utf8'),
);

const from = upstream.pandoc;
const to = pandocVersion();
if (to === from) {
  console.log(
    `The port was reviewed on Pandoc ${to}, the one the oracle runs.`,
  );
  process.exit(0);
}
const OUT = join(ROOT, `.scratch/pandoc-${to}`);
const HACKAGE = join(OUT, 'hackage');

/** A Hackage package's source, unpacked once into `hackage/<id>/`. */
async function unpack(id) {
  const dir = join(HACKAGE, id);
  if (existsSync(dir)) return dir;
  const url = `https://hackage.haskell.org/package/${id}/${id}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  mkdirSync(HACKAGE, { recursive: true });
  const input = Buffer.from(await response.arrayBuffer());
  const tar = spawnSync('tar', ['-xzf', '-', '-C', HACKAGE], { input });
  if (tar.status !== 0) throw new Error(`${id}: ${tar.stderr}`);
  return dir;
}

/**
 * The unified diff of `a` and `b` (recursive for directories), written to
 * `file` when they differ, with its lines added and removed.
 */
function diff(a, b, file) {
  const run = spawnSync('diff', ['-ruN', a, b], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status > 1) throw new Error(run.stderr);
  if (run.status === 0) return null;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, run.stdout);
  const lines = run.stdout.split('\n');
  const count = (sign) =>
    lines.filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3)))
      .length;
  return `+${count('+')} -${count('-')}`;
}

// The packages every `build-depends` of a .cabal file names.
function dependencies(cabal) {
  const names = new Set();
  let listing = false;
  for (const line of readFileSync(cabal, 'utf8').split('\n')) {
    const field = line.match(/^\s*([\w-]+):\s*(.*)$/);
    if (field) listing = field[1] === 'build-depends';
    const entry = (field ? field[2] : line).trim();
    if (listing && /^[A-Za-z]/.test(entry)) {
      for (const part of entry.split(',')) {
        const name = part.trim().match(/^[A-Za-z][\w-]*/);
        if (name) names.add(name[0]);
      }
    }
  }
  return names;
}

// The changelog's sections after `from`, up to `to`.
function changelog(file) {
  const heading = (v) =>
    new RegExp(`^## pandoc ${v.replaceAll('.', '\\.')} `, 'm');
  const text = readFileSync(file, 'utf8');
  const start = text.search(heading(to));
  const end = text.search(heading(from));
  return start < 0 || end < start ? '' : text.slice(start, end);
}

const table = (header, rows) =>
  rows.length === 0
    ? '\nNone.\n'
    : `\n| ${header.join(' | ')} |\n|${header.map(() => ' --- |').join('')}\n${rows
        .map((r) => `| ${r.join(' | ')} |`)
        .join('\n')}\n`;

const pandocFrom = await unpack(`pandoc-${from}`);
const pandocTo = await unpack(`pandoc-${to}`);

const modules = [];
for (const module of Object.keys(upstream.modules)) {
  const path = `src/${module.replaceAll('.', '/')}.hs`;
  const a = join(pandocFrom, path);
  const b = join(pandocTo, path);
  const moved = existsSync(b)
    ? diff(a, b, join(OUT, 'pandoc', `${module}.diff`))
    : 'removed';
  if (moved) modules.push([`\`${module}\``, moved, `pandoc/${module}.diff`]);
}
for (const path of Object.keys(upstream.data)) {
  const name = path.replaceAll('/', '-');
  const moved = diff(
    join(pandocFrom, path),
    join(pandocTo, path),
    join(OUT, 'pandoc', `${name}.diff`),
  );
  if (moved) modules.push([`\`${path}\``, moved, `pandoc/${name}.diff`]);
}

const before = dependencies(join(pandocFrom, 'pandoc.cabal'));
const after = dependencies(join(pandocTo, 'pandoc.cabal'));
const added = [...after].filter((n) => !before.has(n)).sort();
const dropped = [...before].filter((n) => !after.has(n)).sort();
diff(
  join(pandocFrom, 'pandoc.cabal'),
  join(pandocTo, 'pandoc.cabal'),
  join(OUT, 'pandoc.cabal.diff'),
);

const names = Object.keys(upstream.libraries);
const links = pandocLinks([...names, ...added]);
const libraries = [];
for (const name of names) {
  const follows = upstream.libraries[name].version;
  const linked = links.get(name);
  if (linked.join() === follows) continue;
  if (linked.length !== 1 || name === 'ghc') {
    libraries.push([name, follows, linked.join(', ') || 'none', '']);
    continue;
  }
  const file = `libraries/${name}-${follows}-${linked[0]}.diff`;
  const moved = diff(
    await unpack(`${name}-${follows}`),
    await unpack(`${name}-${linked[0]}`),
    join(OUT, file),
  );
  libraries.push([name, follows, linked[0], moved ? file : '']);
}
for (const name of added) {
  const linked = links.get(name);
  if (linked.length === 1) await unpack(`${name}-${linked[0]}`);
}

writeFileSync(
  join(OUT, 'changelog.md'),
  changelog(join(pandocTo, 'changelog.md')),
);

const paths = Object.keys(upstream.modules)
  .map((m) => `src/${m.replaceAll('.', '/')}.hs`)
  .concat(Object.keys(upstream.data));

writeFileSync(
  join(OUT, 'README.md'),
  `# Pandoc ${from} → ${to}

What moved upstream since the port was reviewed on ${from}; the review:
docs/bumping-pandoc.md. Sources unpacked in \`hackage/\`; Pandoc's changes in
its own words in \`changelog.md\`.

## Ported modules and data that changed
${table(['Upstream', 'Lines', 'Diff'], modules)}
${Object.keys(upstream.modules).length + Object.keys(upstream.data).length - modules.length} others unchanged.

## Libraries the port follows, moved
${table(['Library', 'Follows', 'Linked', 'Diff'], libraries)}
## Pandoc's dependencies

Added: ${added.map((n) => `${n} ${links.get(n).join(', ') || '(not linked)'}`).join(', ') || 'none'}.
Dropped: ${dropped.join(', ') || 'none'}. In full: \`pandoc.cabal.diff\`.

## Commits

\`\`\`sh
git -C <pandoc clone> log --format='%h %ad %s' --date=short ${from}..${to} -- \\
  ${paths.join(' \\\n  ')}
\`\`\`
`,
);
console.log(`${join(OUT, 'README.md')}`);
