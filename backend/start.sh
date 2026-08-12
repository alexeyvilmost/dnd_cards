#!/bin/sh
set -eu

NODE_ENV=production RULES_WORKER_PORT="${RULES_WORKER_PORT:-9090}" node ./rules-worker/worker.mjs &
worker_pid=$!

worker_ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    wait "$worker_pid"
    exit 1
  fi
  if wget -q -O /dev/null "http://127.0.0.1:${RULES_WORKER_PORT:-9090}/health"; then
    worker_ready=1
    break
  fi
  sleep 1
done
if [ "$worker_ready" -ne 1 ]; then
  echo "rules worker did not become ready" >&2
  kill "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
  exit 1
fi

./main &
api_pid=$!

shutdown() {
  kill "$worker_pid" "$api_pid" 2>/dev/null || true
}
trap shutdown INT TERM EXIT

while kill -0 "$worker_pid" 2>/dev/null && kill -0 "$api_pid" 2>/dev/null; do
  sleep 1
done

shutdown
wait "$worker_pid" 2>/dev/null || true
wait "$api_pid" 2>/dev/null || true
exit 1
