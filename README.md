# prettier-plugin-pandoc

Format [Pandoc](https://pandoc.org/) markdown with
[prettier](https://prettier.io/) without changing what Pandoc reads, and lint
it: three packages built on a port of Pandoc's own Markdown reader.

Status: before 1.0. The formatting grows construct by construct; blocks it does
not format yet print as written.

## Packages

| Package                                                                     | What it is                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`@knight-owl-llc/prettier-plugin-pandoc`](packages/prettier-plugin-pandoc) | The prettier plugin                                                     |
| [`@knight-owl-llc/pandoc-parser`](packages/pandoc-parser)                   | Pandoc's Markdown reader, ported: its AST, with source spans            |
| [`@knight-owl-llc/pandoc-lint`](packages/pandoc-lint)                       | What Pandoc warns of reading a manuscript, at its file, line and column |

Each package's README covers its use.

## Development

Run `make help` for the commands. Tests run in a test image carrying Node and a
pinned Pandoc: formatting must leave Pandoc's parse of every corpus file
unchanged, and that parse is the oracle. The plugin's `test/expected/` holds the
output aimed at. [docs/playbook.md](docs/playbook.md) has the recipes for
fuzzing, probing, snapshots and benchmarks.

## Releasing

The three packages share one version. `make release RELEASE=patch` (or `minor`,
`major`, an explicit `X.Y.Z`; `AUTOMERGE=1` to queue it), or the Release
workflow, stamps it into every package and opens a `release/vX.Y.Z` PR. Merging
it tags `vX.Y.Z`, which publishes: the `pandoc-lint` binaries for linux x64 and
arm64, each with `LICENSE`, `NOTICE.md` and the source it was built from,
attested and on a GitHub Release with checksums; then the packages on npm, with
provenance. `publish.yml` refuses a tag the packages' version does not match.

`gh attestation verify <tarball> --repo knight-owl-dev/prettier-plugin-pandoc`
proves a binary was built by that workflow from its tag.

## License

GPL-2.0-or-later, as Pandoc's: [LICENSE](LICENSE). The parser ports Pandoc's
Markdown reader; [NOTICE.md](NOTICE.md) gives its provenance and the notices of
the libraries ported with it.
