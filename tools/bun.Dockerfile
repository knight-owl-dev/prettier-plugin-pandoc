# Bun, for pandoc-lint's standalone build: `make bun-check` compiles the CLI
# with it and checks the binary lints as Node does. Debian's glibc, which the
# compiled binary links against.

FROM oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e
