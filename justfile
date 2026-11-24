# Development commands of server-room (see AGENTS.md, "Development"). AGENTS.md, skills and
# scripts call these recipes, not the tools.

set positional-arguments

# List the recipes
default:
    @just --list

# Formatting (Prettier, PHP-CS-Fixer), linting (ESLint), static analysis (PHPStan)
check:
    npx prettier --check .
    npx eslint .
    vendor/bin/php-cs-fixer check --diff --using-cache=no
    vendor/bin/phpstan analyse --no-progress --memory-limit=1G

# Format (Prettier, PHP-CS-Fixer)
fmt:
    npx prettier --write .
    vendor/bin/php-cs-fixer fix --using-cache=no

# The working tree with the sample installation (PHP's built-in server): 8081 admin, 8082 regular user
serve:
    #!/bin/sh
    set -eu
    sample=docs/sample
    export ENV_FILE="$PWD/$sample/env" PROXY_CONFS="$PWD/$sample/proxy-confs/*.subdomain.conf" \
        SNAPSHOT_FILE="$(mktemp -d)/stacks.json" PAGE_INDEX="$PWD/index.php"
    "$sample/snapshot.sh" "$SNAPSHOT_FILE" &
    php -S 127.0.0.1:8081 "$sample/router.php" &
    exec php -S 127.0.0.1:8082 "$sample/router.php"

# The image with the sample installation behind a stand-in for SWAG (needs Docker: host only)
demo:
    docker compose up --build

# Measure the animation (AGENTS.md, "Performance"); --check fails on regressions
perf *args:
    docs/perf/perf.sh "$@"

# Regenerate the screenshots and GIFs (AGENTS.md, "Screenshots"); "shots" or "gif" for one kind
capture *args:
    docs/screenshots/capture/capture.sh "$@"

# The devcontainer cannot push: push a release on the host with dev-kit-host push server-room main v<x.y.z>
# Prepare a release (changelog, version, commit, tag)
release version summary:
    dev-kit release "$1" -m "$2"

# Deploy the release on origin/main and wait for it
deploy:
    dev-kit deploy
