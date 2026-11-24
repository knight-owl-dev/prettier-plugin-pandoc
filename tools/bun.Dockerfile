# Bun, for pandoc-lint's standalone build: `make bun-check` compiles the CLI
# with it and checks the binary lints as Node does. Debian's glibc, which the
# compiled binary links against.

FROM oven/bun:1.4.5-debian@sha256:3dddea58e1f8f2240eca906b023fedb944f9a8352515a35309fd0c879fe00aaa
