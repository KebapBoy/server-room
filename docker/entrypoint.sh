#!/bin/sh
# PHP-FPM in the background, nginx in the foreground; the health check covers both
set -e
php-fpm85 -D
exec nginx -e stderr -g 'daemon off;'
