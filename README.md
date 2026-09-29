# prettier-plugin-pandoc

Format [Pandoc](https://pandoc.org/) markdown with [prettier](https://prettier.io/) without breaking its block syntax.

Prettier's markdown parser is CommonMark, which folds Pandoc's block constructs — fenced divs, line blocks, definition lists — into the paragraph around them, and reads markdown inside raw TeX. This plugin keeps prettier's own parser and printer and settles only where each Pandoc construct begins and ends, by Pandoc's rules.

Status: pre-release. Nothing is published yet.

## Packages

| Package | What it is |
| --- | --- |
| [`@knight-owl-dev/prettier-plugin-pandoc`](packages/prettier-plugin-pandoc) | The prettier plugin |
| [`@knight-owl-dev/pandoc-syntax`](packages/pandoc-syntax) | Where Pandoc's constructs begin and end; no prettier dependency |

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
| Fancy lists (`a.`, `i.`, `#.`, `(a)`, `1)`) | Handled, verbatim |
| Inline raw TeX (`\footnote{…}`) | Handled |

Each holds inside block quotes and list items as at the top level: Pandoc collects a container's text before parsing it, and so does the recognizer.

## Options

| Option | Default | What it is |
| --- | --- | --- |
| `pandocTabStop` | `4` | Pandoc's `--tab-stop`: the columns a tab advances to, and the indentation that makes code. Set it to what your documents are built with. |

For documents built with `pandoc --tab-stop=8`, in `.prettierrc`:

```json
{ "plugins": ["@knight-owl-dev/prettier-plugin-pandoc"], "pandocTabStop": 8 }
```

## Preserve, never repair

Markup Pandoc reads as broken stays as written. A fence a paragraph continues into is that paragraph's text to Pandoc, and an unclosed div runs to the end of the document; the plugin prints both as it finds them, since repairing either would change what the document means.

## Development

Run `make help` for the commands. Tests run in a test image carrying Node and a pinned Pandoc: formatting must leave Pandoc's parse of every corpus file unchanged, and that parse is the oracle.

## License

[MIT](LICENSE)
