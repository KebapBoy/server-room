# Node for the capture script, PHP for the page, Chromium to render it, ffmpeg for the GIFs
FROM node:24-alpine AS capture
RUN apk add --no-cache chromium ffmpeg php85 php85-curl php85-ctype ttf-liberation font-dejavu font-noto \
 && ln -sf /usr/bin/php85 /usr/bin/php

# The devcontainer (.devcontainer/devcontainer.json): the same tools plus git, and /capture, /perf
# and /work where capture.mjs and perf.mjs expect them, so capture.sh and perf.sh run without Docker.
# Claude Code for user node (native installer, updates itself; on Alpine it needs libgcc, libstdc++
# and the system ripgrep). Its settings and sign-in live in ~/.claude, a volume mounted by
# devcontainer.json, so they survive rebuilds; the directory exists here so the new volume belongs
# to node.
FROM capture AS dev
RUN apk add --no-cache bash curl git less libgcc libstdc++ openssh-client ripgrep \
 && ln -s /workspaces/server-room/docs/screenshots/capture /capture \
 && ln -s /workspaces/server-room/docs/perf /perf \
 && mkdir /work && chown node:node /work
USER node
RUN curl -fsSL https://claude.ai/install.sh | bash -s stable \
 && mkdir -p /home/node/.claude
ENV PATH=/home/node/.local/bin:$PATH CLAUDE_CONFIG_DIR=/home/node/.claude USE_BUILTIN_RIPGREP=0
