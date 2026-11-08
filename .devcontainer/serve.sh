#!/bin/sh
# Dev server of the devcontainer: serves the working tree live with the made-up installation in
# docs/screenshots/capture/sample, port 8081 as the admin Alex, 8082 as the regular user Sam.
# Started by postStartCommand, log in /tmp/serve.log. Your own .env is never read.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
sample=$repo/docs/screenshots/capture/sample
export ENV_FILE="$sample/env" SNAPSHOT_FILE=/tmp/server-room/stacks.json PAGE_INDEX="$repo/index.php"

"$sample/snapshot.sh" "$SNAPSHOT_FILE" &
php -S 0.0.0.0:8081 "$sample/router.php" &
exec php -S 0.0.0.0:8082 "$sample/router.php"
