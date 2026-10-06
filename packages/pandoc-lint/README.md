# @knight-owl-dev/pandoc-lint

What Pandoc warns of reading a manuscript, and what it misreads, at its file,
line and column.

The files are read as Pandoc reads several, one document in the order given: a
definition in one file serves the others, and a div left open runs on into the
next. Each warning Pandoc's reader logs becomes a diagnostic in the file it is
in, once, however often Pandoc logs it; so does what Pandoc reads other than as
written and logs nothing of.

## CLI

```sh
pandoc-lint [--format=text|json|github] [--strict] [--info] [--tab-stop=N] FILE...
```

| Option       | What it does                                                                   |
| ------------ | ------------------------------------------------------------------------------ |
| `--format`   | `text` (the default) for people, `json` for tools, `github` for GitHub Actions |
| `--strict`   | Exit 1 on a warning too                                                        |
| `--info`     | Report Pandoc's INFO messages as well                                          |
| `--tab-stop` | Pandoc's `--tab-stop`, 4 by default                                            |

Diagnostics go to stdout. The exit status is 1 on an error, or on a warning with
`--strict`; 2 on a usage error.

Text output frames each diagnostic as
[keystone](https://keystone.knight-owl.dev/engine/diagnostics/) does, after a
location editors read:

```text
ch2.md:3:1: WARN: link reference [a] is defined again
  ch1.md:1:1: [a]: /a
  │ 3 | [a]: /b
  │   | ^^^^^^^
  Links use the last definition.
```

Its layout follows keystone's. For a tool, read the JSON.

In GitHub Actions, `--format=github` writes each diagnostic as a workflow
command, so the run and a pull request's diff show it on its line.

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

| Field                  | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `version`              | The format's version; a change that breaks a reader raises it           |
| `rule`                 | Pandoc's message type in kebab case                                     |
| `severity`             | `warn`, or `info` for Pandoc's INFO messages                            |
| `source`               | The file, as given                                                      |
| `start`, `end`         | Offsets into the file, in UTF-16 code units; the end exclusive          |
| `line`, `column`       | Where it starts, from 1; a column a code point                          |
| `endLine`, `endColumn` | Where it ends, exclusive; within the file it starts in                  |
| `callouts`             | The message in keystone's callouts: `problem` always, the others as apt |

Diagnostics come by file in the order given, then by where they start.

## Rules

The first two are what Pandoc reads other than as written; the rest are its own
messages.

| Rule                        | Severity | What it finds                                                                          |
| --------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `block-in-paragraph`        | error    | A div or code fence, heading, quote or list on the line after paragraph text           |
| `div-fence-length`          | warn     | A closing fence whose length differs from its opener's, in a nest of differing lengths |
| `unclosed-div`              | warn     | A div closed only by the document's end                                                |
| `duplicate-link-reference`  | warn     | A reference defined again, elsewhere                                                   |
| `duplicate-note-reference`  | warn     | A note defined again                                                                   |
| `note-defined-but-not-used` | warn     | A note no reference uses                                                               |
| `duplicate-identifier`      | warn     | An identifier given that one already has                                               |
| `yaml-warning`              | warn     | A metadata key given again                                                             |
| `macro-already-defined`     | warn     | A macro or environment defined again                                                   |
| `undefined-toggle`          | warn     | `\iftoggle` of a toggle not defined                                                    |
| `parsing-unescaped`         | info     | A TeX special character left unescaped                                                 |
| `skipped-content`           | info     | Raw TeX Pandoc drops                                                                   |

## API

`lint(files, options)` lints `[{path, text}]` as one manuscript;
`lintSnippet(text, {source, line, column, indent})` lints markdown taken from
another file, placed where it is there. `formatText`, `formatJson` and
`formatGithub` print what either returns.
