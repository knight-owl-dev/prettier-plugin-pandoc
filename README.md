# prettier-plugin-pandoc

Format [Pandoc](https://pandoc.org/) markdown with [prettier](https://prettier.io/) without breaking its block syntax.

Prettier's markdown parser is CommonMark, which folds Pandoc's block constructs — fenced divs, line blocks, definition lists — into the paragraph around them. This plugin keeps prettier's own parser and printer and settles only where each Pandoc block begins and ends, by Pandoc's rules.

Status: pre-release. Nothing is published yet.

## Packages

| Package | What it is |
| --- | --- |
| [`@knight-owl-dev/prettier-plugin-pandoc`](packages/prettier-plugin-pandoc) | The prettier plugin |
| [`@knight-owl-dev/pandoc-blocks`](packages/pandoc-blocks) | Where Pandoc's blocks begin and end; no prettier dependency |

## Constructs

| Construct | Status |
| --- | --- |
| Fenced divs | Handled |
| Line blocks | Handled |
| Definition lists | Handled, verbatim |
| Grid tables | Handled |
| Simple and multiline tables | Handled |
| Example lists | Handled, verbatim |
| Raw TeX blocks | Handled |

## Preserve, never repair

Markup Pandoc reads as broken stays as written. A fence a paragraph continues into is that paragraph's text to Pandoc, and an unclosed div runs to the end of the document; the plugin prints both as it finds them, since repairing either would change what the document means.

## Development

Run `make help` for the commands. Tests run in a test image carrying Node and a pinned Pandoc: formatting must leave Pandoc's parse of every corpus file unchanged, and that parse is the oracle.

## License

[MIT](LICENSE)
