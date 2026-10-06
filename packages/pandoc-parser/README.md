# @knight-owl-llc/pandoc-parser

Pandoc's Markdown reader, ported from Pandoc 3.11 to JavaScript: a document's
AST as Pandoc reads it, each node with the span of the source it was read from.

The AST is Pandoc's JSON with a `start` and `end` on each node:
`JSON.stringify(withoutSpans(doc))` equals `pandoc -f markdown -t json` of the
same text. It reads with Pandoc's default Markdown extensions, and raw TeX with
its port of Pandoc's LaTeX reader.

## Use

```js
import { readMarkdown } from "@knight-owl-llc/pandoc-parser";

const doc = readMarkdown(text, { tabStop: 4 });
doc.blocks[0].start; // where the first block starts in `text`
```

| Export                              | What it is                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `readMarkdown(text, {tabStop})`     | The document as Pandoc's Markdown reader reads it                                            |
| `readLaTeX(text, options)`          | The document as Pandoc's LaTeX reader reads it                                               |
| `withoutSpans(value)`               | A read with its spans left out: Pandoc's JSON                                                |
| `toSources(files)`                  | Several files joined as Pandoc's CLI reads them, and the way back from an offset to its file |
| `continuesParagraph(next, options)` | Whether Pandoc reads a paragraph on into the line `next`                                     |
| `DEFAULT_TAB_STOP`                  | Pandoc's default `--tab-stop`, 4                                                             |

A Markdown read carries four more properties, kept out of its JSON:

| Property         | What it holds                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `definitions`    | Each reference definition, and the span of each of its parts                                      |
| `log`            | The messages Pandoc logs reading the document, in its order, each with Pandoc's fields and a span |
| `unresolved`     | Each reference and note looked up and not found: its kind, form, label and span                   |
| `metadataBlocks` | Each YAML metadata block and title block Pandoc read metadata from: its kind and span             |

Offsets count UTF-16 code units, as JavaScript strings index.

## License

GPL-2.0-or-later, as Pandoc's: [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) gives
the provenance of the port and the notices of the libraries ported with it.
