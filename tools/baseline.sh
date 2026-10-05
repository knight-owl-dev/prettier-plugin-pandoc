#!/bin/sh
# A baseline checkout for comparisons, at .scratch/wt/base, detached at a
# commit so no branch is held. Its node_modules links every package but the
# workspace's own, which resolve to the baseline's: linked whole, they
# would run this checkout's packages.
#
#   tools/baseline.sh add [REF]    tools/baseline.sh remove
set -eu
W=.scratch/wt/base
case ${1:-} in
  add)
    [ -d "$W" ] && "$0" remove
    git worktree add --detach "$W" "$(git rev-parse "${2:-main}")" >/dev/null 2>&1
    mkdir "$W/node_modules"
    for e in node_modules/* node_modules/.[!.]*; do
      n=$(basename "$e")
      [ "$n" = "@knight-owl-dev" ] && continue
      ln -s "../../../../node_modules/$n" "$W/node_modules/$n"
    done
    mkdir "$W/node_modules/@knight-owl-dev"
    for p in "$W"/packages/*; do
      n=$(basename "$p")
      ln -s "../../packages/$n" "$W/node_modules/@knight-owl-dev/$n"
    done
    git -C "$W" log --oneline -1
    ;;
  remove)
    rm -rf "$W/node_modules"
    git worktree remove --force "$W"
    git worktree prune
    ;;
  *)
    echo "usage: tools/baseline.sh add [REF] | remove" >&2
    exit 2
    ;;
esac
