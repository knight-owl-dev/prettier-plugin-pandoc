#!/usr/bin/env bash
set -euo pipefail

#
# Pack a pandoc-lint binary for release: the binary, the license and notices
# it is conveyed under, and SOURCE, which names the source it was built
# from. Writes dist/pandoc-lint-v<version>-linux-<arch>.tar.gz.
#
# Usage:
#   tools/release/package.sh <x64|arm64>
#

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

arch="$1"
case "${arch}" in
  x64 | arm64) ;;
  *)
    echo "usage: $(basename "$0") <x64|arm64>" >&2
    exit 1
    ;;
esac

version="$(tools/release/get-version.sh)"
name="pandoc-lint-v${version}-linux-${arch}"
binary=".scratch/bun/pandoc-lint-${arch}"
[[ -x "${binary}" ]] || {
  echo "ERROR: no binary at ${binary}; run make bun-check first" >&2
  exit 1
}

stage="$(mktemp -d)"
trap 'rm -rf "${stage}"' EXIT
mkdir "${stage}/${name}"
cp "${binary}" "${stage}/${name}/pandoc-lint"
cp LICENSE NOTICE.md "${stage}/${name}/"
cat > "${stage}/${name}/SOURCE" << SOURCE
pandoc-lint v${version}, from @knight-owl-llc/pandoc-lint, compiled with Bun.

Licensed under GPL-2.0-or-later (LICENSE); NOTICE.md gives its provenance.
Its source, complete: https://github.com/knight-owl-dev/prettier-plugin-pandoc/tree/v${version}
SOURCE

mkdir -p dist
tar -czf "dist/${name}.tar.gz" -C "${stage}" "${name}"
echo "dist/${name}.tar.gz"
