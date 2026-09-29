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
- **A construct is a recognizer.** One module under
  `packages/pandoc-syntax/src/blocks/`, a test asking Pandoc, a corpus file,
  and a position in `registry.js`. The order is Pandoc's precedence, so a
  comment there says why it sits there.
- **`pandoc-syntax` imports no prettier.** It is the one answer to where a
  Pandoc construct starts, for a linter and a language server as much as for
  the plugin; a printer concern belongs in the plugin.
- **An inline span may be wider than Pandoc's, never narrower.** Pandoc's
  LaTeX reader knows each command's arity; a scan does not. Text frozen by a
  wider span prints as written, so its test checks containment.
- **A fence is only markup where a block may start.** After a paragraph or
  list item line it is that block's text; after a heading, an HTML comment or
  a raw TeX block it opens a div. Probe Pandoc before encoding a rule.
- **Masking keeps offsets.** Markup is overwritten in place, never removed, so
  every position the stock parser reports indexes the source. Each fill and
  why: `mask.js`.
- **The tab stop decides indentation.** Pandoc's `--tab-stop` sets both tab
  expansion and how deep code starts, so every indentation rule derives from
  `syntaxFor(tabStop)` in `pandoc-syntax`. Prettier's own parser reads at four
  whatever it is — where the two part, the plugin masks. Probe Pandoc at more
  than one stop before encoding an indentation rule.
- **Containers are collected, then read.** Pandoc parses a container's
  collected lines as a document of its own; CommonMark decides line by line.
  Where their extents part, the plugin prints the container as written,
  decided by comparing prettier's tree, never predicted: `containers.js`.
- **Stock prettier trims code blocks.** Its line breaks drop trailing
  whitespace, which in a sample is a hard break shown; the plugin prints code
  through literal lines instead. The oracle runs both embedded settings, since
  `auto` reformats a tagged sample and `off` leaves it to that printer.
- **Keep issue numbers out of commit messages.** They belong in the PR.
