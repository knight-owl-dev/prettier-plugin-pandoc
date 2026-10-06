# @knight-owl-llc/prettier-plugin-pandoc

Format [Pandoc](https://pandoc.org/) markdown with
[prettier](https://prettier.io/) without changing what Pandoc reads.

The plugin reads a document with
[`@knight-owl-llc/pandoc-parser`](https://www.npmjs.com/package/@knight-owl-llc/pandoc-parser),
a port of Pandoc's own Markdown reader, and prints structure from that read and
text as the source wrote it. It then reads its output again: what reads
differently prints as written.

## Install

```sh
npm install --save-dev prettier @knight-owl-llc/prettier-plugin-pandoc
```

In `.prettierrc`:

```json
{ "plugins": ["@knight-owl-llc/prettier-plugin-pandoc"] }
```

The plugin takes over prettier's `markdown` parser, so every file prettier reads
as Markdown is read as Pandoc's.

## What it formats

- One blank line between top-level blocks.
- Paragraphs reflowed, with prettier's emphasis markers.
- Headings in ATX form.
- List markers and reference definitions as prettier writes them.
- Pipe tables aligned.
- Fenced code with a fence fit for its content.
- Block quotes, lists, definition lists, divs and note definitions printed from
  their structure.

Other blocks print as written.

Markup Pandoc reads as broken stays as written. A fence a paragraph continues
into is that paragraph's text to Pandoc, and an unclosed div runs to the end of
the document; the plugin prints both as it finds them, since repairing either
would change what the document means.

## Options

| Option          | Default | What it is                                                                                                                          |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pandocTabStop` | `4`     | Pandoc's `--tab-stop`: the columns a tab advances to, and the indentation that makes code. Match what the documents are built with. |

For documents built with `pandoc --tab-stop=8`:

```json
{ "plugins": ["@knight-owl-llc/prettier-plugin-pandoc"], "pandocTabStop": 8 }
```

Prettier's `proseWrap` reflows paragraphs: `preserve` (the default) keeps every
line break where the author put it, `always` fills to `printWidth`, `never`
joins each paragraph into one line. `embeddedLanguageFormatting` `auto`, the
default, reformats a fenced sample tagged with a language prettier formats
(`yaml`, `json`, …); `off` prints every sample as written.

`<!-- prettier-ignore -->` leaves the block after it as written, and
`<!-- prettier-ignore-start -->` … `<!-- prettier-ignore-end -->` everything
between.

## License

GPL-2.0-or-later: [LICENSE](LICENSE), [NOTICE.md](NOTICE.md).
