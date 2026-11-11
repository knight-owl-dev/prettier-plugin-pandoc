# Bumping Pandoc

`pandoc-parser` follows one Pandoc release: the one the oracle runs.
[`upstream.json`](../packages/pandoc-parser/upstream.json) records it:

| Field       | Holds                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `pandoc`    | The release the port was last reviewed on, its Hackage sdist's sha256 |
| `modules`   | Each ported Pandoc module, with the release it was ported from        |
| `data`      | Each Pandoc data file taken, with its release                         |
| `libraries` | Each library the port follows: its version, sdist sha256 and modules  |

A module or data file keeps its release through a review that ports nothing into
it: `pandoc` alone names the release the whole port was reviewed on.

`upstream.test.js` checks the record against the oracle's binary, its release
and the library versions it links, and against the modules the ports' `@see`
tags name. The tools that read sources from Hackage refuse any whose sha256
differs from the record's, since those are the bytes the review read.

## A bump arrives

A Pandoc release arrives as a Renovate PR moving `PANDOC_AMD64` and
`PANDOC_ARM64` in [`tools/Dockerfile`](../tools/Dockerfile). Its Test job fails
in `upstream.test.js`, which names the release and each library that moved, and
wherever the port now reads a document differently from Pandoc.

The review lands on that branch, and its log goes in a comment on the PR, since
Renovate owns the body. Main's oracle stays on the old release until the PR
merges, so a port of new behavior would fail there; only a speed-up can land on
main first.

## 1. Measure

```sh
gh pr checkout <number>
make test-image
make pandoc-drift
make test > .scratch/pandoc-<release>/test.log
```

The test image is one tag for every branch: build it again after switching
branches, or the oracle is whichever Pandoc built last. `make test`'s failures
are the regression, each a document the port now reads differently.

`pandoc-drift` writes `.scratch/pandoc-<release>/`:

- `README.md`: each ported module, data file and library that changed, with its
  diff; Pandoc's dependencies added and dropped.
- `changelog.md`: Pandoc's changelog since the reviewed release.

The sources it diffed, both releases' and each changed library's, stay unpacked
in `.scratch/hackage/`. The README ends in a `git log` over the ported modules'
paths, which a clone of Pandoc turns into the commit behind each hunk:

```sh
git clone --filter=blob:none https://github.com/jgm/pandoc .scratch/pandoc
git -C .scratch/pandoc show <commit>
```

## 2. Review

Read `changelog.md` first: it names in Pandoc's words what changed for users.
Then each row of the drift README is a review item, and each hunk of its diff
gets one verdict:

| Verdict   | The hunk                                                    | Then                                                 |
| --------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| behavior  | changes what a document reads as, logs or fails with        | port it                                              |
| unreached | changes a function or branch the port has no counterpart of | nothing                                              |
| speed     | changes cost alone                                          | port it when the port's structure maps it; benchmark |
| refactor  | moves or renames, behavior kept                             | follow the rename where the port names it (`@see`)   |

`git grep '@see Text.Pandoc.Readers.Markdown.bracketedSpan'` finds a function's
port. Where it finds none, the hunk is unreached, and a probe of its input
(`make probe`) confirms that Pandoc and the port read it alike.

Beyond Pandoc's own modules:

- **A library that moved** is reviewed the same way, through its diff.
- **A dependency Pandoc adds** in place of one the port follows (yamlet for
  yaml) is ported from its source.
- **A generated table** is generated again once its source is restamped:
  `make tables` (playbook § Generate the tables again).
- **GHC** moving means checking `data-char.js` against its Unicode version.

Each verdict goes into the review log, one row per change:

```markdown
| Upstream                       | Change                  | Verdict  | Port                |
| ------------------------------ | ----------------------- | -------- | ------------------- |
| `Text.Pandoc.Readers.Markdown` | span keeps inner spaces | behavior | `markdown/links.js` |
| `Text.Pandoc.Readers.Markdown` | more `takeWhile1P`      | speed    | —                   |
| yaml → yamlet                  | `yes`, `no` are strings | behavior | `yamlet/schema.js`  |
```

A divergence kept on purpose gets a row too, its verdict `diverges` and its
reason.

## 3. Port

For each behavior row:

1. Probe the input that shows it (`make probe`), at more than one tab stop where
   indentation is involved.
2. Port the hunk where its `@see` points, as `CLAUDE.md` § Gotchas says.
3. Add the input as a case to the module's test, compared against Pandoc.
4. Prove the case catches the change: restore the source alone
   (`git show HEAD:<file> > <file>`), see the case fail, then put the port back
   and see it pass.
5. Commit it alone, its subject the change: "Keep a bracketed span's inner
   spaces, as Pandoc 3.13 does".

After each area, run `make test` and that area's fuzzers. A test helper changed
on the way has callers in `tools/` as well, so `git grep` for them across the
repo.

Work split between people or agents still lands on the one branch, each part
brought in by cherry-pick, with conflicts to expect in `upstream.json` and in
test files both sides touched. Parallel work belongs in worktrees outside the
repo, because the linters take a worktree inside it for the repo's own files and
`lint-fix` rewrites them. Since `git stash` is shared between worktrees, work
set aside goes in a commit.

## 4. Restamp

In `upstream.json`:

- `pandoc`: the new release, with the sha256 the drift README gives.
- `modules`, `data`: the new release where a behavior row was ported into it;
  the rest stay. A module is added or dropped as the `@see` names change.
- `libraries`: each at the version `upstream.test.js` names, with the sha256 the
  drift README gives; one added or dropped with its port.

`NOTICE.md` gains or loses a library with the port, and takes a license that
changed (the library's diff shows its `LICENSE`); each package's copy follows.

## 5. Check

```sh
make test
make lint
make fuzz-print SEED=1
make fuzz-parser KIND=markdown SEED=1
make fuzz-parser KIND=containers SEED=1
make fuzz-parser KIND=raw-tex SEED=1
make fuzz-parser KIND=yaml SEED=1
make fuzz-parser KIND=latex EXT=+raw_tex-latex_macros SEED=1
make fuzz-parser KIND=latex-tables EXT=+raw_tex-latex_macros SEED=1
```

Run several seeds of each, as the [playbook](playbook.md) says (§ Fuzz before a
printer or parser PR). The PR merges once green, by rebase when its commits are
the ports, one per change, and a port whose reads changed is then released
(README § Releasing).
