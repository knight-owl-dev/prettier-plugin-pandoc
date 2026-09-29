# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

A prettier plugin for Pandoc markdown, and the block recognizer it is built on.
See [README.md](README.md). The plan of record is
[keystone#773](https://github.com/knight-owl-dev/keystone/issues/773).

## Commands

Always use `make` targets; run `make help` for the list. Node, npm and Pandoc
come from the test image, the linters from the pinned `ci-tools` image — never
the host.

## Gotchas

- **Pandoc's parse is the oracle.** A change is correct when Pandoc reads the
  formatted file as it read the source, soft breaks aside — not when the output
  looks right. Add a corpus file per construct; a construct not handled yet
  stays in the oracle's `TODO` set so it runs.
- **`pandoc-syntax` imports no prettier.** It is the one answer to where a
  Pandoc block starts, for a linter and a language server as much as for the
  plugin; a printer concern belongs in the plugin.
- **A fence is only markup where a block may start.** After a paragraph or
  list item line it is that block's text; after a heading, an HTML comment or
  a raw TeX block it opens a div. Probe Pandoc before encoding a rule.
- **Masking keeps offsets.** A block's markup is overwritten in place, never
  removed, so every position the stock parser reports indexes the source. What
  it is overwritten with is chosen for the block CommonMark must see there:
  spaces for a div fence, `#` for each raw TeX line — an indented tail would
  otherwise read as code.
- **Stock prettier trims code blocks.** Its line breaks drop trailing
  whitespace, which in a sample is a hard break shown; the plugin prints code
  through literal lines instead. The oracle runs both embedded settings, since
  `auto` reformats a tagged sample and `off` leaves it to that printer.
- **Keep issue numbers out of commit messages.** They belong in the PR.
