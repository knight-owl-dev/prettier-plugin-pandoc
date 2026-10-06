// What each package's tarball holds, as `npm pack` would pack it: its
// LICENSE and NOTICE.md, its manifest and README, and its sources, nothing
// else. Fails naming what is missing or stray.
//
//   node tools/pack-check.mjs

import { execFileSync } from 'node:child_process';

const REQUIRED = ['LICENSE', 'NOTICE.md', 'package.json'];
const ALLOWED = /^(LICENSE|NOTICE\.md|README\.md|package\.json|src\/.+)$/;

const packs = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--workspaces'], {
    encoding: 'utf8',
  }),
);
let failed = false;
for (const { name, files } of packs) {
  const paths = files.map((f) => f.path);
  const missing = REQUIRED.filter((p) => !paths.includes(p));
  const stray = paths.filter((p) => !ALLOWED.test(p));
  for (const p of missing) console.error(`${name}: missing ${p}`);
  for (const p of stray) console.error(`${name}: stray ${p}`);
  failed ||= missing.length + stray.length > 0;
  console.log(`${name}: ${paths.length} files`);
}
process.exit(failed ? 1 : 0);
