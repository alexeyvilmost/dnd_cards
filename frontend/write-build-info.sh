#!/bin/sh
set -eu
# The image supplies this file; SOURCE_COMMIT is deliberately never consulted.
# Path parameters are for local shell tests, never supplied by release env.
IDENTITY_PATH="${1:-/opt/bagofholding/component-identity.json}"
BUILD_INFO_PATH="${2:-/usr/share/nginx/html/build-info.json}"
BUILD_INFO_TMP="${BUILD_INFO_PATH}.tmp"
RELEASE_COMMIT="${RELEASE_COMMIT:-}"
RELEASE_ID="${RELEASE_ID:-}"
if ! printf '%s' "$RELEASE_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then RELEASE_COMMIT=''; fi
if ! printf '%s' "$RELEASE_ID" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'; then RELEASE_ID=''; fi
# Build-time generator writes a single complete JSON object. Missing/invalid
# image metadata fails startup, rather than manufacturing provenance from env.
test -s "$IDENTITY_PATH"
grep -Eq '^\{"identitySchemaVersion":1,"component":"frontend",.*\}$' "$IDENTITY_PATH"
{
  sed 's/}$//' "$IDENTITY_PATH" | tr -d '\n\r'
  printf ',"releaseCommit":"%s","releaseId":"%s"}\n' "$RELEASE_COMMIT" "$RELEASE_ID"
} > "$BUILD_INFO_TMP"
mv "$BUILD_INFO_TMP" "$BUILD_INFO_PATH"
