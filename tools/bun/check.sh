#!/bin/sh
# Compile pandoc-lint with Bun for linux x64 and arm64, and lint with the
# binary for this machine: the JSON goes to $OUT/bun.json, for `make
# bun-check` to compare with Node's. The other target's binary is checked
# for its architecture alone: this machine cannot run it.
set -eu

OUT=.scratch/bun
mkdir -p "$OUT"
case "$(uname -m)" in
  aarch64 | arm64) native=arm64 other=x64 ;;
  *) native=x64 other=arm64 ;;
esac

for target in x64 arm64; do
  bun build --compile --minify --target="bun-linux-$target" \
    packages/pandoc-lint/src/cli.js --outfile "$OUT/pandoc-lint-$target" \
    >"$OUT/build-$target.log" 2>&1 || {
    cat "$OUT/build-$target.log" >&2
    exit 1
  }
done

# ELF's e_machine, at byte 18: 62 is x86-64, 183 AArch64.
machine() { od -An -tu2 -j18 -N2 "$1" | tr -d ' '; }
want() { [ "$1" = x64 ] && echo 62 || echo 183; }
[ "$(machine "$OUT/pandoc-lint-$other")" = "$(want "$other")" ] || {
  echo "pandoc-lint-$other is not a linux-$other binary" >&2
  exit 1
}

start=$(date +%s%N)
"$OUT/pandoc-lint-$native" --format=json --info "$@" >"$OUT/bun.json" || true
end=$(date +%s%N)

for target in x64 arm64; do
  size=$(wc -c <"$OUT/pandoc-lint-$target")
  echo "pandoc-lint-$target: $((size / 1048576)) MB"
done
echo "linted with pandoc-lint-$native in $(((end - start) / 1000000)) ms"
