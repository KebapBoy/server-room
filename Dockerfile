# server-room as a container: nginx and PHP-FPM, behind SWAG and Authelia (README, "Running as a
# container"). Stage "capture" renders the screenshots and measures the animation (capture.sh,
# perf.sh), stage "dev" is the devcontainer, the last stage "app" the image that runs the page (the
# default target).

# Alpine with PHP 8.5 and the extensions the page needs
FROM alpine:3.24 AS base
RUN apk add --no-cache php85 php85-curl

# The page: its files and VERSION, nothing else of the repository
FROM base AS build
WORKDIR /app
COPY VERSION index.php page.html.php style.css intro.js rack.js favicon.svg ./

# Node for the capture and perf scripts, PHP for the page, Chromium to render it, ffmpeg for the
# GIFs. Needs nothing from the build context.
FROM node:24-alpine AS capture
RUN apk add --no-cache chromium ffmpeg php85 php85-curl php85-ctype ttf-liberation font-dejavu font-noto \
    && ln -sf /usr/bin/php85 /usr/bin/php

# Devcontainer: the capture tools plus Composer and what PHP-CS-Fixer and PHPStan need, user dev
# (UID 1000, the image's user node renamed). /capture, /perf, /sample and /work are where
# capture.mjs and perf.mjs expect them, so capture.sh and perf.sh run without Docker. Claude Code,
# git, just and dev-kit come from the dev-kit feature (.devcontainer/devcontainer.json).
FROM capture AS dev
COPY --from=composer:2.11.1 /usr/bin/composer /usr/local/bin/composer
RUN apk add --no-cache php85-dom php85-iconv php85-mbstring php85-openssl php85-phar php85-tokenizer \
        php85-xml php85-xmlwriter \
    && deluser --remove-home node \
    && { delgroup node 2>/dev/null || true; } \
    && adduser -D -u 1000 -s /bin/sh dev \
    && ln -s /workspaces/server-room/docs/screenshots/capture /capture \
    && ln -s /workspaces/server-room/docs/perf /perf \
    && ln -s /workspaces/server-room/docs/sample /sample \
    && mkdir /work \
    && chown dev:dev /work
ENV SERVER_ROOM_DEVCONTAINER=1
USER dev

# The page: nginx and PHP-FPM as user server-room (UID 1000), port 8080. It reads the stack
# snapshot from /data/stacks.json and SWAG's proxy confs from /config/nginx/proxy-confs, both
# mounted read-only. VERSION labels the image when a build sets it (CI); the page reports the
# version from the file VERSION at /healthz.
FROM base AS app
ARG VERSION=dev
LABEL org.opencontainers.image.title=server-room \
    org.opencontainers.image.description="Start page for SWAG and Authelia, drawn as a server rack" \
    org.opencontainers.image.source=https://github.com/KebapBoy/server-room \
    org.opencontainers.image.licenses=MIT \
    org.opencontainers.image.version=$VERSION
RUN apk add --no-cache nginx php85-fpm \
    && adduser -D -H -u 1000 -s /sbin/nologin server-room \
    && mkdir /data
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/php-fpm.conf /etc/php85/php-fpm.conf
COPY docker/entrypoint.sh /entrypoint.sh
COPY --from=build /app /app
ENV SNAPSHOT_FILE=/data/stacks.json
USER server-room
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
