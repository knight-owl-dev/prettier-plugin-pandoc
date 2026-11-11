// What moved upstream between the Pandoc the port was reviewed on
// (`upstream.json`) and the one the oracle runs: each ported module's diff,
// each followed library's at the version the new binary links, Pandoc's
// dependencies added and dropped, and its changelog between the two. Sources
// come from Hackage (`lib/hackage.mjs`). Writes `.scratch/pandoc-<to>/`; its
// README.md is the summary the review in docs/bumping-pandoc.md starts from.
//
//   node tools/drift.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, unpack } from './lib/hackage.mjs';
import { load, ROOT } from './lib/run.mjs';

const { pandocLinks, pandocVersion } = await load(
  'packages/pandoc-parser/test/helpers/oracle.js',
);
const upstream = JSON.parse(
  readFileSync(join(ROOT, 'packages/pandoc-parser/upstream.json'), 'utf8'),
);

const from = upstream.pandoc.release;
const to = pandocVersion();
if (to === from) {
  console.log(
    `The port was reviewed on Pandoc ${to}, the one the oracle runs.`,
  );
  process.exit(0);
}
const OUT = join(ROOT, `.scratch/pandoc-${to}`);

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

// The packages the library's `build-depends` name, its common stanzas' too:
// an entry runs on in lines indented past its field.
function dependencies(cabal) {
  const names = new Set();
  let library = false;
  let listing = -1;
  for (const line of readFileSync(cabal, 'utf8').split('\n')) {
    const indent = line.search(/\S/);
    if (indent === 0) library = /^(library|common)\b/.test(line);
    if (indent >= 0 && indent <= listing) listing = -1;
    const field = line.match(/^\s*build-depends:\s*(.*)$/);
    if (library && field) listing = indent;
    const entry = (field ? field[1] : line).trim();
    if (listing >= 0 && /^[A-Za-z]/.test(entry)) {
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

const pandocFrom = await unpack(`pandoc-${from}`, upstream.pandoc.sha256);
const pandocTo = await unpack(`pandoc-${to}`);

// Each ported module and data path by its source path, and the name of its
// diff.
const ported = [
  ...Object.keys(upstream.modules).map((m) => [
    m,
    `src/${m.replaceAll('.', '/')}.hs`,
  ]),
  ...Object.keys(upstream.data).map((p) => [p, p]),
];
const modules = [];
for (const [name, path] of ported) {
  const file = `pandoc/${name.replaceAll('/', '-')}.diff`;
  const moved = existsSync(join(pandocTo, path))
    ? diff(join(pandocFrom, path), join(pandocTo, path), join(OUT, file))
    : 'removed';
  if (moved) modules.push([`\`${name}\``, moved, file]);
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
  const { version: follows, sha256 } = upstream.libraries[name];
  const linked = links.get(name);
  if (linked.join() === follows) continue;
  if (linked.length !== 1 || name === 'ghc') {
    libraries.push([name, follows, linked.join(', ') || 'none', '', '']);
    continue;
  }
  const file = `libraries/${name}-${follows}-${linked[0]}.diff`;
  const moved = diff(
    await unpack(`${name}-${follows}`, sha256),
    await unpack(`${name}-${linked[0]}`),
    join(OUT, file),
  );
  const id = `${name}-${linked[0]}`;
  libraries.push([
    name,
    follows,
    linked[0],
    `\`${digest(id)}\``,
    moved ? file : '',
  ]);
}
for (const name of added) {
  const linked = links.get(name);
  if (linked.length === 1) await unpack(`${name}-${linked[0]}`);
}

// An added dependency, the version Pandoc links and its sdist's sha256.
function addedEntry(name) {
  const linked = links.get(name);
  if (linked.length !== 1)
    return `${name} (${linked.join(', ') || 'not linked'})`;
  return `${name} ${linked[0]} (\`${digest(`${name}-${linked[0]}`)}\`)`;
}

writeFileSync(
  join(OUT, 'changelog.md'),
  changelog(join(pandocTo, 'changelog.md')),
);

const paths = ported.map(([, path]) => path);

writeFileSync(
  join(OUT, 'README.md'),
  `# Pandoc ${from} → ${to}

What moved upstream since the port was reviewed on ${from}; the review:
docs/bumping-pandoc.md. Sources unpacked in \`.scratch/hackage/\`; Pandoc's
changes in its own words in \`changelog.md\`.

Pandoc ${to}'s sdist sha256, for the restamp: \`${digest(`pandoc-${to}`)}\`.

## Ported modules and data that changed
${table(['Upstream', 'Lines', 'Diff'], modules)}
${ported.length - modules.length} others unchanged.

## Libraries the port follows, moved
${table(['Library', 'Follows', 'Linked', 'Linked sha256', 'Diff'], libraries)}
## Pandoc's dependencies

Added: ${added.map(addedEntry).join(', ') || 'none'}.
Dropped: ${dropped.join(', ') || 'none'}. In full: \`pandoc.cabal.diff\`.

## Commits

\`\`\`sh
git -C <pandoc clone> log --format='%h %ad %s' --date=short ${from}..${to} -- \\
  ${paths.join(' \\\n  ')}
\`\`\`
`,
);
console.log(`${join(OUT, 'README.md')}`);
