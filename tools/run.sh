#!/bin/sh
# Run a command in the compose `node` service under a host-side watchdog:
# a hung run is killed after SECONDS, since `timeout` in the image cannot
# stop node. Exit status is the command's, or 124 after a kill.
#
#   tools/run.sh SECONDS COMMAND...
set -u
limit=$1
shift
name="prettier-plugin-pandoc-run-$$"
tty=-T
[ -t 0 ] && [ -t 1 ] && tty=
# A background job's stdin is /dev/null unless handed over.
exec 3<&0
DOCKER_UID=$(id -u) DOCKER_GID=$(id -g) \
  docker compose --progress quiet run --rm $tty --name "$name" node "$@" <&3 &
pid=$!
# The watchdog holds no output open, so a pipe reading this ends with the
# command, and its sleep goes with it when the command ends first.
(
  sleep "$limit" &
  nap=$!
  trap 'kill $nap; exit 0' TERM
  wait $nap
  docker kill "$name" >/dev/null 2>&1 && touch "/tmp/$name.killed"
) >/dev/null 2>&1 &
dog=$!
wait $pid
status=$?
kill $dog 2>/dev/null
if [ -e "/tmp/$name.killed" ]; then
  rm -f "/tmp/$name.killed"
  echo "run.sh: killed after ${limit}s" >&2
  exit 124
fi
exit $status
