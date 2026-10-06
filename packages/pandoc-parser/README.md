# @knight-owl-llc/pandoc-parser

Pandoc 3.11's Markdown reader, ported to JavaScript: a document's AST as Pandoc
reads it, each node with the span of source it was read from.

The AST is Pandoc's JSON with a `start` and `end` on each node:
`JSON.stringify(withoutSpans(doc))` equals `pandoc -f markdown -t json` on the
same text. The reader runs with Pandoc's default Markdown extensions and reads
raw TeX with a port of Pandoc's LaTeX reader.

## Use

```js
import { readMarkdown } from "@knight-owl-llc/pandoc-parser";

const doc = readMarkdown(text, { tabStop: 4 });
doc.blocks[0].start; // where the first block starts in `text`
```

| Export                              | What it is                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `readMarkdown(text, {tabStop})`     | The document as Pandoc's Markdown reader reads it                          |
| `readLaTeX(text, options)`          | The document as Pandoc's LaTeX reader reads it                             |
| `withoutSpans(value)`               | A read without its spans: Pandoc's JSON                                    |
| `toSources(files)`                  | Files joined as Pandoc's CLI joins them, and each offset's way to its file |
| `continuesParagraph(next, options)` | Whether Pandoc reads a paragraph on into the line `next`                   |
| `DEFAULT_TAB_STOP`                  | Pandoc's default `--tab-stop`, 4                                           |

A Markdown read also carries four properties outside its JSON:

| Property         | What it holds                                                                  |
| ---------------- | ------------------------------------------------------------------------------ |
| `definitions`    | Each reference definition, with the span of each of its parts                  |
| `log`            | The messages Pandoc logs on the read, in its order, with its fields and a span |
| `unresolved`     | Each reference and note looked up and not found: kind, form, label and span    |
| `metadataBlocks` | Each YAML metadata block and title block that metadata came from, with a span  |

Offsets are UTF-16 code units, as JavaScript indexes a string.

## License

GPL-2.0-or-later, as Pandoc's: [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) gives
the port's provenance and the notices of the libraries ported with it.
