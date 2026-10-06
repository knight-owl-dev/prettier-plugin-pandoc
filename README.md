# prettier-plugin-pandoc

Format [Pandoc](https://pandoc.org/) markdown with
[prettier](https://prettier.io/) without changing what Pandoc reads.

The plugin reads a document with a port of Pandoc's own Markdown reader, and
prints structure from that read and text as the source wrote it. It then reads
its output again: what reads differently prints as written.

Status: pre-release. Nothing is published yet. Formatting so far: one blank line
between top-level blocks, paragraphs reflowed with prettier's emphasis markers,
headings in ATX form, list markers and reference definitions as prettier writes
them, pipe tables aligned, fenced code with a fence fit for its content, and
block quotes, lists, definition lists, divs and note definitions printed from
their structure. Other blocks print as written until their construct gains
formatting.

## Packages

| Package                                                                     | What it is                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`@knight-owl-dev/prettier-plugin-pandoc`](packages/prettier-plugin-pandoc) | The prettier plugin                                                     |
| [`@knight-owl-dev/pandoc-parser`](packages/pandoc-parser)                   | Pandoc's Markdown reader, ported: its AST, with source spans            |
| [`@knight-owl-dev/pandoc-lint`](packages/pandoc-lint)                       | What Pandoc warns of reading a manuscript, at its file, line and column |

## Options

| Option          | Default | What it is                                                                                                                          |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pandocTabStop` | `4`     | Pandoc's `--tab-stop`: the columns a tab advances to, and the indentation that makes code. Match what the documents are built with. |

For documents built with `pandoc --tab-stop=8`, in `.prettierrc`:

```json
{ "plugins": ["@knight-owl-dev/prettier-plugin-pandoc"], "pandocTabStop": 8 }
```

Prettier's `proseWrap` reflows paragraphs: `preserve` (the default) keeps every
line break where the author put it, `always` fills to `printWidth`, `never`
joins each paragraph into one line. `embeddedLanguageFormatting` `auto`, the
default, reformats a fenced sample tagged with a language prettier formats
(`yaml`, `json`, …); `off` prints every sample as written.

`<!-- prettier-ignore -->` leaves the block after it as written, and
`<!-- prettier-ignore-start -->` … `<!-- prettier-ignore-end -->` everything
between.

## Preserve, never repair

Markup Pandoc reads as broken stays as written. A fence a paragraph continues
into is that paragraph's text to Pandoc, and an unclosed div runs to the end of
the document; the plugin prints both as it finds them, since repairing either
would change what the document means.

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
