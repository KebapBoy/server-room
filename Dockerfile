# The page on its own: nginx and PHP-FPM, run behind SWAG and Authelia (see README, "Running as a container").
# Mount SWAG's proxy confs at /config/nginx/proxy-confs and the folder with stacks.json at /app/data.
FROM alpine:3.24
RUN apk add --no-cache nginx php85-fpm php85-curl \
 && mkdir /app /app/data
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/php-fpm.conf /etc/php85/php-fpm.conf
COPY docker/entrypoint.sh /entrypoint.sh
COPY index.php page.html.php style.css intro.js rack.js favicon.svg /app/
USER nobody
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
