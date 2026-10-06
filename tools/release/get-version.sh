#!/usr/bin/env bash
set -euo pipefail

#
# The packages' version, which they share: fails where they differ, or where
# a package pins pandoc-parser at another.
#
# Usage:
#   tools/release/get-version.sh
#

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

versions="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' packages/*/package.json | sort -u)"
pins="$(sed -n 's/^    "@knight-owl-dev\/pandoc-parser": "\(.*\)"$/\1/p' packages/*/package.json | sort -u)"

if [[ "$(wc -l <<< "${versions}")" -ne 1 || -z "${versions}" ]]; then
  echo "ERROR: the packages' versions differ:" >&2
  grep -H '^  "version"' packages/*/package.json >&2
  exit 1
fi
if [[ -n "${pins}" && "${pins}" != "${versions}" ]]; then
  echo "ERROR: pandoc-parser is pinned at ${pins}, not ${versions}" >&2
  exit 1
fi

echo "${versions}"
