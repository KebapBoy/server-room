#!/bin/sh
# Regenerates the screenshots and GIFs in docs/screenshots from the made-up installation in
# sample/ (see AGENTS.md). Needs only Docker. Pass "shots" or "gif" to redo just one kind.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
image=server-room-capture
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

docker build -q -t "$image" "$here" >/dev/null

# The page as it is in the working tree, with the sample .env instead of yours
mkdir -p "$work/site" "$work/out"
for file in index.php page.html.php style.css intro.js rack.js favicon.svg; do
    cp "$repo/$file" "$work/site/"
done
cp "$here/sample/env" "$work/site/.env"

run() {
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
        -v "$here:/capture:ro" -v "$work:/work" "$image" "$@"
}

run node /capture/capture.mjs "${1:-}"

# Screencast frames to GIF: real frame timing, 10 fps, 960 px wide, one palette per GIF
for gif in intro signout; do
    [ -f "$work/frames/$gif/list.txt" ] || continue
    run sh -c "cd /work/frames/$gif && ffmpeg -loglevel error -y -f concat -safe 0 -i list.txt \
        -vf 'fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle' \
        /work/out/$gif.gif"
done

cp "$work/out/"* "$repo/docs/screenshots/"
ls -l "$repo/docs/screenshots/"
