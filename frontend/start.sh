#!/bin/sh
set -eu

PORT="${PORT:-3000}"
export PORT

echo ">>> dnd-cards frontend: PORT=${PORT}"

rm -f /etc/nginx/conf.d/default.conf

envsubst '${PORT}' < /etc/nginx/templates/app.conf.template > /etc/nginx/conf.d/app.conf

# Railway иногда продолжает маршрутизировать публичный трафик на 3000 (старый vite dev),
# тогда как $PORT уже другой. Дублируем listener на 3000, если это не основной порт.
if [ "$PORT" != "3000" ]; then
  cat >> /etc/nginx/conf.d/legacy-port.conf <<'EOF'
server {
    listen 0.0.0.0:3000;
    listen [::]:3000;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    access_log /dev/stdout;
    error_log /dev/stderr warn;

    location /health {
        access_log off;
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri /index.html;
    }
}
EOF
  echo ">>> dnd-cards frontend: extra listener on :3000 (legacy Railway port)"
fi

nginx -t
echo ">>> dnd-cards frontend: nginx config OK, starting..."
exec nginx -g 'daemon off;'
