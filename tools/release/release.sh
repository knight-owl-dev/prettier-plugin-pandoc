#!/usr/bin/env bash
set -euo pipefail

#
# Open a release PR: stamp the next version into every package and the
# lockfile, on a release/vX.Y.Z branch. Merging it tags vX.Y.Z
# (tag-release.yml), which publishes the release (publish.yml).
#
# A bump starts from the latest release tag; an explicit version is for the
# first release, a jump, or a correction.
#
# Usage:
#   tools/release/release.sh <major|minor|patch|X.Y.Z>
#
# Environment:
#   GH_TOKEN           In CI, the App token the push and PR run under, so the PR
#                      starts CI. Locally, the caller's own git and gh auth.
#   GITHUB_REPOSITORY  In CI, owner/repo for the token remote.
#   AUTOMERGE          Non-empty queues the PR to squash-merge once checks pass.
#

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ $# -ne 1 ]]; then
  echo "usage: $(basename "$0") <major|minor|patch|X.Y.Z>" >&2
  exit 1
fi

git fetch --tags --quiet 2> /dev/null || true

case "$1" in
  major | minor | patch)
    latest="$(git tag --list 'v*' | sed -n 's/^v\([0-9]*\.[0-9]*\.[0-9]*\)$/\1/p' | sort -V | tail -n 1)"
    if [[ -z "${latest}" ]]; then
      echo "ERROR: no release tag to bump from; name the first version explicitly" >&2
      exit 1
    fi
    IFS=. read -r major minor patch <<< "${latest}"
    case "$1" in
      major) VERSION="$((major + 1)).0.0" ;;
      minor) VERSION="${major}.$((minor + 1)).0" ;;
      patch) VERSION="${major}.${minor}.$((patch + 1))" ;;
    esac
    echo "Latest release v${latest}, bumping $1 to v${VERSION}"
    ;;
  *)
    VERSION="$(tools/release/validate-version.sh "${1#v}")"
    ;;
esac

if ! git diff --quiet || ! git diff --staged --quiet; then
  echo "ERROR: the working tree has changes; the stamp must be the release PR's only change" >&2
  exit 1
fi

if git rev-parse --quiet --verify "refs/tags/v${VERSION}" > /dev/null; then
  echo "ERROR: v${VERSION} is already released" >&2
  exit 1
fi

# Two open release PRs would both stamp from the same tag, and whichever merges
# second would release a version the first already moved past.
existing="$(gh pr list --state open --limit 1000 --json number,headRefName \
  --jq 'map(select(.headRefName | startswith("release/v"))) | .[0].number // empty')"
if [[ -n "${existing}" ]]; then
  echo "ERROR: release PR #${existing} is open; merge or close it first" >&2
  exit 1
fi

if [[ -n "${GH_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
fi

# From main as GitHub has it, whatever is checked out here, so the stamp is the
# PR's only change.
git fetch --quiet origin main
BRANCH="release/v${VERSION}"
git switch --quiet -c "${BRANCH}" origin/main

tools/release/stamp.sh "${VERSION}"
make --no-print-directory resolve > /dev/null

git add packages/*/package.json package-lock.json
git commit --quiet -m "Release v${VERSION}"
git push --quiet -u origin "${BRANCH}"

pr_url="$(gh pr create --base main --head "${BRANCH}" --title "Release v${VERSION}" \
  --body "Merging this PR tags v${VERSION}, which publishes the release.")"
echo "Opened ${pr_url}"

if [[ -n "${AUTOMERGE:-}" ]]; then
  gh pr merge --auto --squash "${pr_url}"
  echo "Queued to merge once checks pass"
fi
