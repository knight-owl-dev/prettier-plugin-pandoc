# Bun, for pandoc-lint's standalone build: `make bun-check` compiles the CLI
# with it and checks the binary lints as Node does. Debian's glibc, which the
# compiled binary links against.

FROM oven/bun:1.4.3-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b
