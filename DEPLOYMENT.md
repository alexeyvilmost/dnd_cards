# Деплой Bag of Holding в Timecloud

Production работает на Timecloud Linux-сервере `77.95.206.239` через Docker
Compose. Публичная граница обоих сервисов — `https://bagofholding.ru`: Caddy
маршрутизирует `/api/*` в Go backend, а остальные запросы — в nginx frontend.

## Release identity

Релизом считается точный 40-символьный Git SHA из `origin/main`. Серверный
runner передаёт его обоим контейнерам через `SOURCE_COMMIT`:

- backend публикует SHA в `GET /api/health`;
- frontend публикует SHA в `GET /build-info.json`.

Выкладка завершена только когда оба endpoint возвращают один и тот же ожидаемый
SHA. Отсутствующее или невалидное значение закрывает release gate.

## Production layout

| Компонент | Путь |
| --- | --- |
| Корень приложения | `/opt/bagofholding` |
| Активный релиз | `/opt/bagofholding/current` |
| Неизменяемые релизы | `/opt/bagofholding/releases/<SHA>` |
| Архивы сборок | `/opt/bagofholding/builds/<SHA>.tar` |
| Секреты приложения | `/opt/bagofholding/shared/app.env` |
| Параметры Compose | `/opt/bagofholding/shared/deploy.env` |
| Резервные копии PostgreSQL | `/opt/bagofholding/shared/backups/` |
| Серверный runner | `/opt/bagofholding/bin/deploy-release` |

## Release flow

1. Проверить изменения и отправить allowlisted commit в `origin/main`.
2. Пройти обязательный offline CI gate.
3. Создать `git archive` точного SHA с `core.autocrlf=false`.
4. Загрузить архив на Timecloud и сверить его SHA-256.
5. Запустить `deploy-release <SHA>`.
6. Runner создаст production `pg_dump`, соберёт два image, атомарно переключит
   `current`, дождётся health-check и проверит оба публичных SHA endpoint.
7. Выполнить production UX и content-certification gates.

При неуспешном запуске или identity-check runner автоматически возвращает
предыдущий application release. База данных при этом не откатывается, поэтому
миграции обязаны сохранять expand/contract совместимость.

Полная повторяемая процедура, команды проверки, rollback и диагностика:
[`docs/standalone-deploy-after-push.md`](docs/standalone-deploy-after-push.md).

Канонические production-файлы находятся в `infra/`:

- `infra/compose.prod.yml`;
- `infra/Caddyfile`;
- `infra/deploy-release`;
- `infra/production.env.example`.
