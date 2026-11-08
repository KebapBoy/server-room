#!/bin/sh
# Measures the frame rate and main-thread cost of the animated rack (see AGENTS.md, "Performance").
# Needs only Docker. Usage: perf.sh [--check] [repo-dir]   (default: this working tree; pass a git
# worktree to measure another revision). --check exits non-zero on animations inside an SVG or
# dropped frames on desktop and tablet. Set PERF_OUT=<file> to keep the JSON results,
# PERF_UNCAPPED=1 to lift the 60 fps cap.
set -eu

check=
if [ "${1:-}" = --check ]; then check=1; shift; fi

here=$(cd "$(dirname "$0")" && pwd)
capture=$(cd "$here/../screenshots/capture" && pwd)
repo=$(cd "${1:-$here/../..}" && pwd)
image=server-room-capture
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

docker build -q -t "$image" "$capture" >/dev/null

# The page as it is in the chosen tree, with the sample .env instead of yours
mkdir -p "$work/site" "$work/out"
for file in index.php page.html.php style.css intro.js rack.js favicon.svg; do
    cp "$repo/$file" "$work/site/"
done
cp "$capture/sample/env" "$work/site/.env"

# /capture is the screenshot folder (router.php, sample data), /perf this folder
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e PERF_UNCAPPED="${PERF_UNCAPPED:-}" -e PERF_CHECK="$check" \
    -v "$capture:/capture:ro" -v "$here:/perf:ro" -v "$work:/work" "$image" node /perf/perf.mjs || status=$?

[ -z "${PERF_OUT:-}" ] || cp "$work/out/perf.json" "$PERF_OUT"
exit "${status:-0}"
