#!/bin/sh
# Writes sample/stacks.json to <target> every 30 s with the current time as "generated", like the
# snapshot job of a real installation (temp file plus rename). Used by the demo in compose.yaml and
# the dev server of the devcontainer. Usage: snapshot.sh <target>
set -eu

sample=$(dirname "$0")/stacks.json
target=$1
mkdir -p "$(dirname "$target")"
trap 'exit 0' INT TERM

while :; do
    sed "s/\"generated\": *[0-9]*/\"generated\": $(date +%s)/" "$sample" > "$target.tmp"
    mv "$target.tmp" "$target"
    sleep 30 &
    wait $!
done
