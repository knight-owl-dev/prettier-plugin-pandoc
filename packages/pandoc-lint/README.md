# @knight-owl-llc/pandoc-lint

Lint Pandoc Markdown: Pandoc's warnings and misreads, each at its file, line and
column.

Pandoc joins its input files into one document, in the order given, and so does
the linter: a definition in one file serves the others, and a div left open runs
on into the next. Each warning Pandoc logs becomes one diagnostic in the file it
falls in, however often Pandoc logs it. So does each misread, which Pandoc
passes without a warning.

## Install

```sh
npm install --save-dev @knight-owl-llc/pandoc-lint
```

Each
[GitHub Release](https://github.com/knight-owl-dev/prettier-plugin-pandoc/releases)
also carries a standalone binary, for Linux x64 and arm64, that needs no Node.

## CLI

```sh
pandoc-lint [--format=text|json|github] [--strict] [--info] [--no-metadata] [--tab-stop=N]
            [--shortcuts=FILE]... [FILE]...
pandoc-lint --version
```

| Option          | What it does                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| `--format`      | `text` (the default) for people, `json` for tools, `github` for GitHub Actions |
| `--strict`      | Exit 1 on a warning too                                                        |
| `--info`        | Report Pandoc's INFO messages too                                              |
| `--no-metadata` | Report metadata in the Markdown, for a project that keeps it elsewhere         |
| `--tab-stop`    | Pandoc's `--tab-stop`, 4 by default                                            |
| `--shortcuts`   | A keystone shortcuts file to lint ([Shortcuts](#shortcuts)); repeatable        |
| `--version`     | Print its version and the Pandoc release it follows, then exit                 |

Diagnostics go to stdout. The exit status is 1 on an error, or on a warning with
`--strict`, and 2 where it cannot lint: a usage error, a file it cannot read, or
a failure of its own.

Text output starts each diagnostic with a location editors open
(`file:line:column`) and frames it as
[keystone's diagnostics](https://keystone.knight-owl.dev/engine/diagnostics/)
do:

```text
ch2.md:3:1: WARN: link reference [a] is defined again
  ch1.md:1:1: [a]: /a
  │ 3 | [a]: /b
  │   | ^^^^^^^
  Links use the last definition.
```

`--format=github` writes each diagnostic as a workflow command, which GitHub
shows on its line in the run and in a pull request's diff.

`--version` prints `pandoc-lint <version>`, then `pandoc <release>` for the
Pandoc release it follows: the line that release's `pandoc --version` opens
with, so a tool that pins both checks they read alike by comparing the two.

## Shortcuts

`--shortcuts=FILE` lints a keystone shortcuts file, laid out as its
[manual](https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/)
describes. Each shortcut's templates, its `body` and its `span`, are read as
documents of their own, under every rule, and each diagnostic lands at its line
and column in the YAML. A template whose lines are not the file's, folded or
spread over lines or with escapes, reports at its start, as does each place a
finding names in it.

A template is read as a fragment, as keystone reads one: no `%` title block, no
YAML metadata block, and no identifier a heading didn't write. A span's lone
image stays an image, not a figure. Templates are read at `--tab-stop`, as files
are.

The file itself draws errors of its own:

| Rule            | What it finds                              |
| --------------- | ------------------------------------------ |
| `yaml-syntax`   | Invalid YAML                               |
| `shortcut-file` | Anything other than a mapping of shortcuts |
| `shortcut-null` | A null anywhere, at the key that holds it  |
| `shortcut-body` | A `body` that is neither text nor null     |
| `shortcut-span` | A `span` that is neither text nor null     |

A layer
[only overrides](https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#shadowing-a-system-shortcut),
so keystone stops on a null anywhere.

## JSON

```json
{
  "version": 1,
  "diagnostics": [
    {
      "rule": "duplicate-link-reference",
      "severity": "warn",
      "source": "ch2.md",
      "start": 0,
      "end": 7,
      "line": 3,
      "column": 1,
      "endLine": 3,
      "endColumn": 8,
      "callouts": {
        "problem": "link reference [a] is defined again",
        "offenders": ["ch1.md:1:1: [a]: /a"],
        "verbatim": ["3 | [a]: /b", "  | ^^^^^^^"],
        "effect": "Links use the last definition."
      }
    }
  ]
}
```

| Field                  | What it is                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| `version`              | The format's version, raised by a change that breaks a reader                     |
| `rule`                 | The rule, from [Rules](#rules)                                                    |
| `severity`             | `error`, `warn`, or `info` for Pandoc's INFO messages                             |
| `source`               | The file, as given                                                                |
| `start`, `end`         | Offsets into the file in UTF-16 code units; `end` exclusive                       |
| `line`, `column`       | Where it starts, from 1; columns count code points                                |
| `endLine`, `endColumn` | Where it ends, exclusive, in the file it starts in                                |
| `callouts`             | The message in keystone's callouts: `problem` always, the others where they apply |

Diagnostics are ordered by file, as given, then by where they start.

## Rules

`block-in-paragraph`, `div-fence-length`, `undefined-reference` and
`undefined-note` find misreads Pandoc gives no warning for.
`metadata-in-markdown` holds a project to keeping metadata out of its Markdown.
The rest are Pandoc's own messages, in kebab case; `pandoc-parse-error`, where
Pandoc stops reading, is reported alone. A shortcut reference `[text]` nothing
defines goes unreported, since prose writes `[sic]` that way.

| Rule                        | Severity | What it finds                                                                             |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `block-in-paragraph`        | error    | A div or code fence, heading, quote or list after paragraph text; warn in a span template |
| `div-fence-length`          | warn     | A closing fence whose length differs from its opener's, in a nest of such lengths         |
| `undefined-reference`       | warn     | A reference link or image, `[t][r]` or `[t][]`, whose label nothing defines               |
| `undefined-note`            | warn     | A note reference whose label nothing defines                                              |
| `metadata-in-markdown`      | error    | A YAML metadata block or title block; with `--no-metadata` only                           |
| `pandoc-parse-error`        | error    | A YAML metadata block Pandoc cannot read                                                  |
| `unclosed-div`              | warn     | A div closed only by the document's end                                                   |
| `duplicate-link-reference`  | warn     | A reference defined again                                                                 |
| `duplicate-note-reference`  | warn     | A note defined again                                                                      |
| `note-defined-but-not-used` | warn     | A note no reference uses                                                                  |
| `duplicate-identifier`      | warn     | An identifier already in use                                                              |
| `macro-already-defined`     | warn     | A macro or environment defined again                                                      |
| `undefined-toggle`          | warn     | `\iftoggle` on a toggle nothing defines                                                   |
| `parsing-unescaped`         | info     | A TeX special character left unescaped                                                    |
| `skipped-content`           | info     | Raw TeX Pandoc drops                                                                      |

## API

| Export                                                    | What it does                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `lint(files, options)`                                    | Lints `[{path, text}]` as one manuscript                         |
| `lintSnippet(text, {source, line, column, indent, file})` | Lints Markdown taken from another file, placed where it is there |
| `lintShortcuts(path, text, options)`                      | Lints a shortcuts file                                           |
| `formatText`, `formatJson`, `formatGithub`                | Print diagnostics in the CLI's formats                           |

`options` takes `tabStop`, `info` and `noMetadata`, the CLI's flags.

## License

GPL-2.0-or-later, as Pandoc's: [LICENSE](LICENSE), [NOTICE.md](NOTICE.md).
