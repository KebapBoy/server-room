#!/bin/sh
# Dev server of the devcontainer: the page from the working tree with the made-up installation in
# docs/sample, port 8081 as the admin Alex, 8082 as the regular user Sam (just serve). Started by
# postStartCommand, log in /tmp/serve.log. Your own .env is never read.
set -eu

cd "$(dirname "$0")/.."
exec just serve
