# Node for the capture script, PHP for the page, Chromium to render it, ffmpeg for the GIFs
FROM node:24-alpine
RUN apk add --no-cache chromium ffmpeg php84 php84-curl php84-ctype ttf-liberation font-dejavu font-noto \
 && ln -sf /usr/bin/php84 /usr/bin/php
