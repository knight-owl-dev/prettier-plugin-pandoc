#!/usr/bin/env bash
set -euo pipefail

#
# Validate a version for a tag and the packages: MAJOR.MINOR.PATCH alone.
# Prints it back, so a caller assigns the validated value.
#
# Usage:
#   tools/release/validate-version.sh <version>
#

if [[ $# -ne 1 ]]; then
  echo "usage: $(basename "$0") <version>" >&2
  exit 1
fi

if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: invalid version: $1" >&2
  echo "  Expected MAJOR.MINOR.PATCH, such as 0.4.0" >&2
  exit 1
fi

echo "$1"
