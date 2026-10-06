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

In `.prettierrc`, for the files Pandoc builds:

```json
{
  "overrides": [
    {
      "files": "manuscript/**/*.md",
      "options": { "plugins": ["@knight-owl-llc/prettier-plugin-pandoc"] }
    }
  ]
}
```

The plugin replaces prettier's `markdown` parser for those files, and keeps what
Pandoc reads. A CommonMark reader, GitHub's among them, reads some Markdown
differently: to Pandoc, a `- item` line right after paragraph text continues the
paragraph, and the plugin may join the two lines. A README or a changelog stays
on prettier's own parser.

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

## markdownlint

The plugin's output trips markdownlint where Pandoc and CommonMark part ways. A
div's content sits against its fences, so a list or code fence there trips MD031
and MD032; prettier's emphasis, `*` inside a word and `_` elsewhere, trips
MD049's default. For the files the plugin formats:

```yaml
blanks-around-fences: false
blanks-around-lists: false
emphasis-style:
  style: underscore
```

With `tabWidth` above 2, the padded markers trip MD030 and MD007 as well:

```yaml
list-marker-space: false
ul-indent:
  indent: 4 # the tabWidth
```

MD049 still reads a `*` inside raw TeX, which Pandoc passes to TeX, as emphasis.

markdownlint-cli2 applies a `.markdownlint.yaml` to its own directory, so one in
the manuscript's directory holds these for those files alone.

## License

GPL-2.0-or-later: [LICENSE](LICENSE), [NOTICE.md](NOTICE.md).
