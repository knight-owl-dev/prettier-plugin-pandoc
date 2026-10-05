# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

A prettier plugin for Pandoc markdown, and the port of Pandoc's reader it is
built on. See [README.md](README.md). The plan of record is
[keystone#773](https://github.com/knight-owl-dev/keystone/issues/773).

## Commands

Always use `make` targets; run `make help` for the list. Node, npm and Pandoc
come from the compose services (`docker-compose.yaml`), the linters from the
pinned `ci-tools` image — never the host.

## Playbook

Recipes live in [docs/playbook.md](docs/playbook.md); reach for one when:

- **A printer or parser change is ready for a PR** → § Fuzz before a printer or
  parser PR.
- **A fuzz run fails, or a format changes on a second run** → § Shrink a
  failure.
- **Pandoc and `pandoc-parser` may read a document differently** → § Probe a
  document.
- **A change moves the plugin's output** → § Snapshots.
- **A change may cost speed** → § Benchmark.
- **A script is worth running again** → § Add a tool.

## Gotchas

- **Pandoc's parse is the oracle.** A change is correct when Pandoc reads the
  formatted file as it read the source: `oracle.test.js`. The output aimed at is
  the plugin's `test/expected/`; a snapshot not matched yet stays in
  `expected.test.js`'s `TODO` set so it runs.
- **`pandoc-parser` is a port.** Its modules and functions follow Pandoc's, each
  naming its source (`@see`); it imports no prettier.
- **Probe Pandoc before encoding a rule**, at more than one tab stop when the
  rule involves indentation.
- **Structure from the AST, text from spans; what reads differently prints as
  written:** `print.js`, `check.js`.
- **A line breaks only where Pandoc reads the paragraph on:** `wrap.js`.
- **A container prints from the contents the parser read, its prefixes
  rebuilt:** `blocks.js`.
- **Keep issue numbers out of commit messages.** They belong in the PR.
