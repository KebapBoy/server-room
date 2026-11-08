# Node for the capture script, PHP for the page, Chromium to render it, ffmpeg for the GIFs
FROM node:24-alpine AS capture
RUN apk add --no-cache chromium ffmpeg php85 php85-curl php85-ctype ttf-liberation font-dejavu font-noto \
 && ln -sf /usr/bin/php85 /usr/bin/php

# The devcontainer (.devcontainer/devcontainer.json): the same tools plus git, and /capture, /perf
# and /work where capture.mjs and perf.mjs expect them, so capture.sh and perf.sh run without Docker
FROM capture AS dev
RUN apk add --no-cache bash git less openssh-client \
 && ln -s /workspaces/server-room/docs/screenshots/capture /capture \
 && ln -s /workspaces/server-room/docs/perf /perf \
 && mkdir /work && chown node:node /work
