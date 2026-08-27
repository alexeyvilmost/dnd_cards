#!/bin/sh
set -eu

PORT="${PORT:-3000}"
export PORT

echo ">>> dnd-cards frontend: PORT=${PORT}"

# Runtime deployment attestation. Provider-neutral deployments supply
# SOURCE_COMMIT; Railway remains a rollback-compatible fallback.
SOURCE_COMMIT="${SOURCE_COMMIT:-${RAILWAY_GIT_COMMIT_SHA:-}}"
BUILD_INFO_TMP="/usr/share/nginx/html/.build-info.json.tmp"
BUILD_INFO_PATH="/usr/share/nginx/html/build-info.json"
if printf '%s' "$SOURCE_COMMIT" | grep -Eq '^[0-9A-Fa-f]{40}$'; then
  SOURCE_COMMIT="$(printf '%s' "$SOURCE_COMMIT" | tr 'A-F' 'a-f')"
  printf '{"source_commit":"%s"}\n' "$SOURCE_COMMIT" > "$BUILD_INFO_TMP"
else
  printf '{"source_commit":null}\n' > "$BUILD_INFO_TMP"
fi
mv "$BUILD_INFO_TMP" "$BUILD_INFO_PATH"

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

    location = /build-info.json {
        try_files $uri =404;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /sw.js {
        try_files $uri =404;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location = /registerSW.js {
        try_files $uri =404;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location = /manifest.webmanifest {
        try_files $uri =404;
        add_header Cache-Control "no-cache";
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
