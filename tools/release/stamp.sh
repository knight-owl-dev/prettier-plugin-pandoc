#!/usr/bin/env bash
set -euo pipefail

#
# Stamp a version into every package: its `version`, and the pin of
# pandoc-parser in those that depend on it. The lockfile follows with
# `make resolve`.
#
# Usage:
#   tools/release/stamp.sh <version>
#

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
version="$(tools/release/validate-version.sh "$1")"

for manifest in packages/*/package.json; do
  sed -i.bak \
    -e "s/^  \"version\": \"[^\"]*\",$/  \"version\": \"${version}\",/" \
    -e "s/^    \"@knight-owl-dev\/pandoc-parser\": \"[^\"]*\"$/    \"@knight-owl-dev\/pandoc-parser\": \"${version}\"/" \
    "${manifest}"
  rm "${manifest}.bak"
done

stamped="$(tools/release/get-version.sh)"
if [[ "${stamped}" != "${version}" ]]; then
  echo "ERROR: could not stamp ${version} into the packages" >&2
  exit 1
fi
