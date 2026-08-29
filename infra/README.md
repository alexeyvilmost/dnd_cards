# Portable production deployment

The production boundary is a regular Docker Compose project running on the
Timecloud server.

## Topology

- Caddy owns ports 80/443 and automatic TLS.
- `/api/*` is proxied to the Go backend.
- every other path is proxied to the static frontend.
- PostgreSQL is external to Compose and reached through `DATABASE_URL`.
- application secrets live in `/opt/bagofholding/shared/app.env` (mode 0600).

## Required application environment

```dotenv
DATABASE_URL=<managed-postgres-connection-string>
JWT_SECRET=...
OPENAI_API_KEY=...
YANDEX_CLOUD_ACCESS_KEY_ID=...
YANDEX_CLOUD_SECRET_ACCESS_KEY=...
YANDEX_CLOUD_BUCKET_NAME=...
YANDEX_CLOUD_REGION=ru-central1
YANDEX_CLOUD_ENDPOINT=https://storage.yandexcloud.net
CORS_ALLOWED_ORIGINS=https://bagofholding.ru
```

Never place the real file in the repository or a Docker build context.

## Deploy and rollback

Build both application images from the exact Git commit, transfer them to the
host, then run:

```sh
SOURCE_COMMIT=<40-hex-sha> APP_DOMAIN=<hostname> \
  docker compose -f /opt/bagofholding/current/compose.prod.yml up -d
```

Rollback changes only `current` and `SOURCE_COMMIT`; the database is not
rewound. Schema changes must therefore follow expand/contract compatibility.
