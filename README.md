# prettier-plugin-pandoc

Format [Pandoc](https://pandoc.org/) Markdown with
[prettier](https://prettier.io/), and lint it. Both run on a port of Pandoc's
own Markdown reader. A formatted document reads to Pandoc as its source did.

Before 1.0: a block the plugin does not format yet prints as written.

## Packages

| Package                                                                     | What it is                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`@knight-owl-llc/prettier-plugin-pandoc`](packages/prettier-plugin-pandoc) | The prettier plugin                                       |
| [`@knight-owl-llc/pandoc-parser`](packages/pandoc-parser)                   | Pandoc's Markdown reader in JavaScript, with source spans |
| [`@knight-owl-llc/pandoc-lint`](packages/pandoc-lint)                       | Pandoc's warnings and misreads, at file, line and column  |

## Development

`make help` lists the commands. Tests run in an image with Node and a pinned
Pandoc, whose read is the oracle: each formatted corpus file must read as its
source does. The plugin's `test/expected/` holds the output aimed at.
[docs/playbook.md](docs/playbook.md) has the recipes for fuzzing, probing,
snapshots and benchmarks.

## Releasing

The three packages share one version. `make release RELEASE=patch` (or `minor`,
`major`, `X.Y.Z`), or the Release workflow, stamps it into each package and
opens a `release/vX.Y.Z` pull request; `AUTOMERGE=1` queues its merge.

Merging it tags `vX.Y.Z`, and the tag publishes:

- the `pandoc-lint` binaries for Linux x64 and arm64, each packed with
  `LICENSE`, `NOTICE.md` and its source, attested, on a GitHub Release with
  checksums;
- the packages on npm, with provenance.

`publish.yml` refuses a tag the packages' version does not match.
`gh attestation verify <tarball> --repo knight-owl-dev/prettier-plugin-pandoc`
checks that the workflow built a binary from its tag.

## License

GPL-2.0-or-later, as Pandoc's: [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) gives
the port's provenance and the notices of the libraries ported with it.
