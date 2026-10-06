# @knight-owl-llc/pandoc-lint

Report what Pandoc warns of in a manuscript, and what it misreads, at file, line
and column.

The files are read as Pandoc reads several: one document, in the order given. A
definition in one file serves the others, and a div left open runs on into the
next. Each warning Pandoc logs becomes one diagnostic in the file it falls in,
however often Pandoc logs it. A misread Pandoc logs nothing of becomes one too.

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
```

| Option          | What it does                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| `--format`      | `text` (the default) for people, `json` for tools, `github` for GitHub Actions |
| `--strict`      | Exit 1 on a warning too                                                        |
| `--info`        | Report Pandoc's INFO messages too                                              |
| `--no-metadata` | Report metadata in the Markdown, for a project that keeps it elsewhere         |
| `--tab-stop`    | Pandoc's `--tab-stop`, 4 by default                                            |
| `--shortcuts`   | A keystone shortcuts file to lint ([Shortcuts](#shortcuts)); repeatable        |

Diagnostics go to stdout. The exit status is 1 on an error, or on a warning with
`--strict`, and 2 on a usage error.

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

## Shortcuts

`--shortcuts=FILE` lints a keystone shortcuts file, laid out as its
[manual](https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/)
describes. Each shortcut's `body` is read as a document of its own, under every
rule, and each diagnostic lands at its line and column in the YAML. A folded or
quoted body, whose lines are not the file's, reports at its start.

Three errors are about the file itself: `yaml-syntax` for invalid YAML,
`shortcut-file` for anything other than a mapping of shortcuts, and
`shortcut-body` for a body that is not text.

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

| Field                  | What it is                                                          |
| ---------------------- | ------------------------------------------------------------------- |
| `version`              | The format's version, raised by a change that breaks a reader       |
| `rule`                 | The rule, from [Rules](#rules)                                      |
| `severity`             | `error`, `warn`, or `info` for Pandoc's INFO messages               |
| `source`               | The file, as given                                                  |
| `start`, `end`         | Offsets into the file in UTF-16 code units; `end` exclusive         |
| `line`, `column`       | Where it starts, from 1; columns count code points                  |
| `endLine`, `endColumn` | Where it ends, exclusive, in the file it starts in                  |
| `callouts`             | The message in keystone's callouts: `problem` always, others as apt |

Diagnostics are ordered by file, as given, then by where they start.

## Rules

The first four rules find what Pandoc reads other than as written;
`metadata-in-markdown` is a project's own rule; the rest are Pandoc's messages,
named in kebab case. A shortcut reference `[text]` nothing defines goes
unreported, since prose writes `[sic]` that way.

| Rule                        | Severity | What it finds                                                                     |
| --------------------------- | -------- | --------------------------------------------------------------------------------- |
| `block-in-paragraph`        | error    | A div or code fence, heading, quote or list on the line after paragraph text      |
| `div-fence-length`          | warn     | A closing fence whose length differs from its opener's, in a nest of such lengths |
| `undefined-reference`       | warn     | A reference link or image, `[t][r]` or `[t][]`, whose label nothing defines       |
| `undefined-note`            | warn     | A note reference whose label nothing defines                                      |
| `metadata-in-markdown`      | error    | A YAML metadata block or title block; with `--no-metadata` only                   |
| `unclosed-div`              | warn     | A div closed only by the document's end                                           |
| `duplicate-link-reference`  | warn     | A reference defined again                                                         |
| `duplicate-note-reference`  | warn     | A note defined again                                                              |
| `note-defined-but-not-used` | warn     | A note no reference uses                                                          |
| `duplicate-identifier`      | warn     | An identifier already in use                                                      |
| `yaml-warning`              | warn     | A metadata key given again                                                        |
| `macro-already-defined`     | warn     | A macro or environment defined again                                              |
| `undefined-toggle`          | warn     | `\iftoggle` on a toggle nothing defines                                           |
| `parsing-unescaped`         | info     | A TeX special character left unescaped                                            |
| `skipped-content`           | info     | Raw TeX Pandoc drops                                                              |

## API

| Export                                                    | What it does                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `lint(files, options)`                                    | Lints `[{path, text}]` as one manuscript                         |
| `lintSnippet(text, {source, line, column, indent, file})` | Lints Markdown taken from another file, placed where it is there |
| `lintShortcuts(path, text, options)`                      | Lints a shortcuts file                                           |
| `formatText`, `formatJson`, `formatGithub`                | Print diagnostics as the CLI's formats                           |

`options` takes `tabStop`, `info` and `noMetadata`, as the CLI's flags.

## License

GPL-2.0-or-later, as Pandoc's: [LICENSE](LICENSE), [NOTICE.md](NOTICE.md).
