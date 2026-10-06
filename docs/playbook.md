# Maintainer playbook

Recipes for the tools under `tools/`. Each runs by a `make` target in the
compose `node` service (`docker-compose.yaml`): the test image's Node and
Pandoc, no network, the repo mounted at `/work`. `make help` lists every target
with its variables.

Every run stops after `TIMEOUT` seconds (default 1800): a hung parse otherwise
blocks forever, and `timeout` inside the image cannot stop Node. Output the
tools keep lands in `.scratch/`.

## Fuzz before a printer or parser PR

```sh
make fuzz-print SEED=1                 # N=1500 documents per seed
make fuzz-parser KIND=containers SEED=2
```

`fuzz-print` formats random Markdown at random tab stops, widths and
`proseWrap`, and asks the Pandoc CLI to read each output. `fuzz-parser` reads
random documents with `pandoc-parser` and Pandoc. Its `KIND` is `markdown`,
`containers`, `raw-tex` or `yaml`, read as Markdown at random tab stops, or
`latex` and `latex-tables`, which take `EXT=+raw_tex-latex_macros`. Run several
seeds; each draws other documents.

A run ends in a count per kind of failure:

| Kind       | Meaning                                                    |
| ---------- | ---------------------------------------------------------- |
| `misread`  | Pandoc reads the formatted document differently            |
| `unstable` | A second format changes the output                         |
| `differ`   | `pandoc-parser` reads the document differently from Pandoc |
| `span`     | A node's span lies outside its parent's                    |
| `contents` | A container's contents map a child's span wrongly          |
| `log`      | A Markdown read logs other than Pandoc does                |
| `hang`     | Pandoc takes longer than 30 seconds                        |

The first `SHOW` failures print; all of them go to
`.scratch/fuzz/<tool>-<seed>.jsonl`, one case per line.

## Shrink a failure

```sh
make shrink CASE=.scratch/fuzz/print-3.jsonl LINE=2
```

Drops lines, then words, then characters while the case fails the same way. The
first line printed is the shrunk case: saved as a file of its own, it is a
`CASE` again. The rest shows the source and the two formats, or Pandoc's and
`pandoc-parser`'s reads.

## Probe a document

```sh
make probe FILE=.scratch/case.md SPANS=1
printf -- '- a\n  > q\n' | make probe
make probe FILE=.scratch/case.tex FORMAT=latex+raw_tex
```

Prints Pandoc's native read, once where tab stops 2, 4 and 8 agree, and whether
`pandoc-parser` reads the same at each, with where the two part. `SPANS=1` adds
each block with the source it spans, and each container's contents and indent.

## Snapshots

```sh
make snapshots-diff KEYS=always/divs.md   # no KEYS: every snapshot
make snapshots-write KEYS=always/divs.md
```

`test/expected/<proseWrap>/<file>` is the output aimed at for each corpus file.
`snapshots-diff` prints a unified diff per snapshot the current output misses.
After a deliberate change of output, `snapshots-write` takes the new one; drop
each key it now matches from `expected.test.js`'s `TODO` set, and let the PR
show the diffs.

## Benchmark

```sh
make bench WHAT=parser RUNS=7
make bench-compare REF=main
```

`bench` times the combinator core, `readMarkdown` on the corpus and synthetic
documents, and the plugin's format at each `proseWrap`. `WHAT` is `parser`,
`plugin` or `all`. `bench-compare` runs the same cases on a worktree of `REF`
and prints both with the change; results stay in `.scratch/bench/`. Runs vary by
about 10% at `RUNS=3`; decide on `RUNS=7` or more.

The budget: a read costs the same per character at any size, so `corpus x20`
reads no slower per character than `corpus x10`; the plugin formats the corpus
in under 200ms at every `proseWrap`. A case more than 10% slower than `main` at
`RUNS=7` needs its reason in the PR.

## Lint a manuscript

```sh
make pandoc-lint FILES="ch1.md ch2.md"
make pandoc-lint FILES="ch1.md ch2.md" ARGS="--format=json --info"
make pandoc-lint FILES="ch1.md" ARGS="--shortcuts=shortcuts.yaml"
```

Joins the files into one document, in the order given, as Pandoc does, and
reports Pandoc's warnings and misreads at file, line and column, in keystone's
frame. `--info` adds Pandoc's INFO messages; `--strict` exits 1 on a warning;
`--shortcuts` lints a keystone shortcuts file's bodies.

## Bun build

```sh
make bun-check
```

Compiles `pandoc-lint` with the pinned Bun into standalone binaries for linux
x64 and arm64 in `.scratch/bun/`, lints the corpus and a shortcuts fixture with
the one this machine runs, and fails unless its JSON is Node's byte for byte.
The other target is checked for its architecture alone. CI runs it on every PR.

## Add a tool

A tool is a script under `tools/`. It takes positional arguments with defaults
(`args()` in `tools/lib/run.mjs`), and loads the code under test through
`load()`, so `ROOT` can point it at a baseline worktree. It gets a `make`
target, a line in `make help`, a recipe here, and a trigger in `CLAUDE.md`.
