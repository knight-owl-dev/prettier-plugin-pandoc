# Bun, for pandoc-lint's standalone build: `make bun-check` compiles the CLI
# with it and checks the binary lints as Node does. Debian's glibc, which the
# compiled binary links against.

FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
