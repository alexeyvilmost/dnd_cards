# Локальная проверка забега

Фронтенд: http://localhost:3000. API: http://localhost:8080. Движок боя: http://localhost:8090/health.
Все три процесса используют рабочие исходники. Для данных используйте отдельную локальную БД PostgreSQL с актуальным каталогом и миграциями; API применяет миграции при запуске.

Сохраните JSON с переменными окружения вне Git. Нужны `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSLMODE`, `JWT_SECRET`, `RULES_WORKER_TOKEN` (случайная строка не короче32 символов), `RULES_WORKER_URL` (`http://127.0.0.1:8090`) и `CORS_ORIGINS` (`http://localhost:3000`). `DATABASE_URL`, если задан, имеет приоритет перед `DB_*`; не наследуйте адрес рабочей БД в локальном окружении.

В трёх терминалах PowerShell из корня проекта:

```powershell
./scripts/start-roguelike-local.ps1 api -EnvironmentFile C:/private/local-env.json
./scripts/start-roguelike-local.ps1 worker -EnvironmentFile C:/private/local-env.json
./scripts/start-roguelike-local.ps1 frontend -EnvironmentFile C:/private/local-env.json
```

Скрипт собирает API/worker перед запуском. `-SkipBuild` пропускает сборку. Фронтенд обновляется через Vite. После изменения серверных правил перезапустите worker; после изменения Go перезапустите API. Каждый новый бой получает текущий исполняемый артефакт. Уже начатый бой намеренно продолжает использовать сохранённую версию: для приёмки новых правил создавайте новый бой. Архивы worker сохраняются рядом с приватным JSON, либо по `-ArtifactsDirectory`.

Проверки: `go -C backend test ./...`; из frontend — `npx tsc --noEmit`, `npm run lint`, `npm run test:roguelike:headless`, `npm run test:rules-worker`. Журнал локального боя можно экспортировать из `roguelike_combat_events` и проверить через `node frontend/worker/replay.mjs <journal.json> <archived-artifact.cjs>`. Журнал содержит приватную случайность и остаётся вне Git.

Текущий стенд2026-09-07: отдельная БД `boh_roguelike_20260907` в существующем контейнере `dnd_cards_db_level3_local` (порт5434), восстановленная из снимка перед2b0f83e. Приватная конфигурация и журналы находятся в `C:/codex-tools`; исходники — `C:/codex-tools/release-838f0ae-lf`. Проверки через этот стенд не требуют выкладки TimeWeb.
