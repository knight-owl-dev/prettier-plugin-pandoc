# @knight-owl-llc/prettier-plugin-pandoc

Format [Pandoc](https://pandoc.org/) Markdown with
[prettier](https://prettier.io/) without changing what Pandoc reads.

The plugin reads a document with
[`@knight-owl-llc/pandoc-parser`](https://www.npmjs.com/package/@knight-owl-llc/pandoc-parser),
a port of Pandoc's Markdown reader. It prints structure from that read and text
as the source wrote it, then reads its own output: a block that reads
differently prints as written.

## Install

```sh
npm install --save-dev prettier @knight-owl-llc/prettier-plugin-pandoc
```

In `.prettierrc`:

```json
{ "plugins": ["@knight-owl-llc/prettier-plugin-pandoc"] }
```

The plugin replaces prettier's `markdown` parser: every file prettier treats as
Markdown is read as Pandoc reads it.

## What it formats

- One blank line between top-level blocks.
- Paragraphs reflowed, with prettier's emphasis markers.
- Headings in ATX form.
- List markers and reference definitions as prettier writes them.
- Pipe tables aligned.
- Fenced code with a fence fit for its content.
- Block quotes, lists, definition lists, divs and note definitions printed from
  their structure.

Other blocks print as written, and so does markup Pandoc reads as broken. A
fence a paragraph runs into is that paragraph's text, and an unclosed div runs
to the document's end; repairing either would change what the document means.

## Options

| Option                       | What it does                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pandocTabStop`              | Pandoc's `--tab-stop`, 4 by default: the columns a tab advances and the indent that makes code. Match the build's.                  |
| `proseWrap`                  | `preserve` (the default) keeps line breaks as written; `always` fills to `printWidth`; `never` puts each paragraph on one line.     |
| `embeddedLanguageFormatting` | `auto` (the default) reformats a fenced sample tagged with a language prettier formats, such as `yaml`; `off` prints it as written. |
| `tabWidth`                   | Pads a list marker toward it, by up to three spaces, so every line of the item starts at one column: `-   item` at 4.               |

For documents built with `pandoc --tab-stop=8`:

```json
{ "plugins": ["@knight-owl-llc/prettier-plugin-pandoc"], "pandocTabStop": 8 }
```

`<!-- prettier-ignore -->` keeps the next block as written;
`<!-- prettier-ignore-start -->` and `<!-- prettier-ignore-end -->` keep
everything between them.

## License

GPL-2.0-or-later: [LICENSE](LICENSE), [NOTICE.md](NOTICE.md).
