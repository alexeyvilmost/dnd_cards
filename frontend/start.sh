#!/bin/sh
set -eu

PORT="${PORT:-3000}"
export PORT

echo ">>> dnd-cards frontend: PORT=${PORT}"

# Runtime deployment attestation. The Timecloud release runner supplies the
# exact Git object identity through SOURCE_COMMIT.
SOURCE_COMMIT="${SOURCE_COMMIT:-}"
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

nginx -t
echo ">>> dnd-cards frontend: nginx config OK, starting..."
exec nginx -g 'daemon off;'
