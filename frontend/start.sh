#!/bin/sh
set -eu

PORT="${PORT:-3000}"
export PORT

echo ">>> dnd-cards frontend: PORT=${PORT}"

/write-build-info.sh

rm -f /etc/nginx/conf.d/default.conf

envsubst '${PORT}' < /etc/nginx/templates/app.conf.template > /etc/nginx/conf.d/app.conf

nginx -t
echo ">>> dnd-cards frontend: nginx config OK, starting..."
exec nginx -g 'daemon off;'
