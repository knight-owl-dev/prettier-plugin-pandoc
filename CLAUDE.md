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
  formatted file as it read the source; how the output looks is no test. A
  construct not handled yet stays in the oracle's `TODO` set so it runs:
  `oracle.test.js`.
- **A construct is a recognizer.** One module under
  `packages/pandoc-syntax/src/blocks/`, a test asking Pandoc, a corpus file, and
  a position in `registry.js`, with a comment saying why it sits there.
- **`pandoc-syntax` imports no prettier.** It answers where a Pandoc construct
  starts for any consumer; a printer concern belongs in the plugin.
- **Probe Pandoc before encoding a rule**, at more than one tab stop when the
  rule involves indentation.
- **An inline span may be wider than Pandoc's, never narrower:**
  `inlines/tex.js`.
- **Masking keeps offsets:** `mask.js`.
- **The tab stop decides indentation:** `syntax.js`.
- **Containers are collected, then read:** `containers.js`.
- **Where the two parsers part, print as written, found by comparing their
  trees:** `containers.js`, `unread.js`, `stretch.js`.
- **A node the plugin puts inside inline content keeps a type prettier knows as
  inline:** `nodes.js`.
- **Stock prettier trims code blocks:** `print.js`.
- **Keep issue numbers out of commit messages.** They belong in the PR.
