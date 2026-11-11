# Bumping Pandoc

`pandoc-parser` follows one Pandoc release: the one the oracle runs.
[`upstream.json`](../packages/pandoc-parser/upstream.json) records it:

| Field       | Holds                                                          |
| ----------- | -------------------------------------------------------------- |
| `pandoc`    | The release the port was last reviewed on                      |
| `modules`   | Each ported Pandoc module, with the release it was ported from |
| `data`      | Each Pandoc data file taken, with its release                  |
| `libraries` | Each library the port follows, its version and modules         |

`upstream.test.js` holds the record to the oracle's binary (its release, the
library versions it links) and to the modules the ports' `@see` tags name.

## A bump arrives

A Pandoc release arrives as a Renovate PR moving `PANDOC_AMD64` and
`PANDOC_ARM64` in [`tools/Dockerfile`](../tools/Dockerfile). Its Test job fails
in `upstream.test.js`, naming the release and each library that moved. It fails
too wherever the port now reads a document differently from Pandoc.

The review lands on that branch. Main's oracle stays on the old release until it
merges, so a port of new behavior fails there; a speed-up may land on main
first.

## 1. Measure

On the PR's branch:

```sh
make test-image
make test        # the regression: each failure, a read that now differs
make pandoc-drift
```

`pandoc-drift` writes `.scratch/pandoc-<release>/`:

- `README.md`: each ported module, data file and library that changed, with its
  diff; Pandoc's dependencies added and dropped.
- `changelog.md`: Pandoc's changelog since the reviewed release.
- `hackage/`: both releases' sources, and each changed library's.

The README ends in a `git log` over the ported modules' paths: run in a clone of
[jgm/pandoc](https://github.com/jgm/pandoc), it lists each commit behind the
diffs.

## 2. Review

Each row of the drift README is a review item; each hunk of its diff gets one
verdict:

| Verdict   | The hunk                                                    | Then                                                 |
| --------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| behavior  | changes what a document reads as, logs or fails with        | port it                                              |
| unreached | changes a function or branch the port has no counterpart of | nothing                                              |
| speed     | changes cost alone                                          | port it when the port's structure maps it; benchmark |
| refactor  | moves or renames, behavior kept                             | follow the rename where the port names it (`@see`)   |

To find a function's port:
`git grep '@see Text.Pandoc.Readers.Markdown.bracketedSpan'`. Port per
`CLAUDE.md` § Gotchas.

Beyond Pandoc's own modules:

- **A library that moved** is reviewed the same way, through its diff.
- **A dependency Pandoc adds** in place of one the port follows (yamlet for
  yaml) is ported from its source in `hackage/`.
- **A generated table** is generated again once its source is restamped:
  `make tables` (playbook § Generate the tables again).
- **GHC** moving means checking `data-char.js` against its Unicode version.

Each verdict goes into the PR's review log, one row per change:

```markdown
| Upstream                       | Change                  | Verdict  | Port                  |
| ------------------------------ | ----------------------- | -------- | --------------------- |
| `Text.Pandoc.Readers.Markdown` | span keeps inner spaces | behavior | `markdown/links.js`   |
| `Text.Pandoc.Readers.Markdown` | more `takeWhile1P`      | speed    | —                     |
| yaml → yamlet                  | `yes`, `no` are strings | behavior | `data-yaml/decode.js` |
```

## 3. Restamp

In `upstream.json`:

- `pandoc`: the new release.
- `modules`, `data`: the new release for each one ported again; a module added
  or dropped as the `@see` names change.
- `libraries`: each at the version `upstream.test.js` names; one added or
  dropped with its port.

`NOTICE.md` gains or loses a library with the port, and takes a license that
changed (the library's diff shows its `LICENSE`); each package's copy follows.

## 4. Check

```sh
make test
make fuzz-parser KIND=markdown SEED=1   # each KIND, several seeds
make fuzz-print SEED=1
make lint
```

The fuzzers run as the [playbook](playbook.md) says (§ Fuzz before a printer or
parser PR). The PR merges green, its body the review log. A port whose reads
changed is released (README § Releasing).
