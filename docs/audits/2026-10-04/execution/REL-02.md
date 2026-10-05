# REL-02 — контексты и кеш сборки

Дата: 2026-10-04. Статус: **реализация подготовлена; Docker acceptance — awaiting_environment**. Не считать задачу полностью завершённой до реальных cold/warm builds и container smoke. Docker CLI 29.7.2 и Buildx 0.36.1 доступны, Linux daemon pipe отсутствует; проверка `buildx --call=check` также завершается ошибкой соединения. Windows/WSL/BIOS, production builder, CI, registry и TimeWeb не изменялись. Commit/push не выполнялись.

## Подготовленные изменения

- Backend сохраняет контекст `backend/`; frontend и worker используют корень репозитория. В трёх root compose исправлен frontend context и передача `VITE_API_URL` через build args. `infra/compose.test.yml` уже корректен, не изменён; `infra/compose.prod.yml` содержит только готовые images.
- Root и component Dockerignore используют allowlists с финальными запретами local DB/backups/tmp/output/node_modules/.env/dist. Добавлены `frontend/Dockerfile.dockerignore` и `infra/Dockerfile.rules-worker.dockerignore`. Source Markdown, embedded JSON/SQL, assets и лицензии сохраняются.
- Cache mounts разделены по component; lockfile обязателен. Worker копирует только необходимые release planner/manifest scripts, а не весь `scripts/`. Публичные media отсутствуют в worker context.
- Frontend media выделены в самостоятельный финальный COPY layer. App stage получает каноничные DiceBox/PWA inputs и сохраняет `npm run build` с TypeScript/Vite/asset checks. Полный public присутствует в итоговой сборке через отдельный слой.
- `infra/docker-bake.hcl` и opt-in `infra/docker-bake.cache-gha.hcl` задают независимые cache scopes. Они не подключены к CI; никаких внешних действий не запускают.
- `scripts/release/measure-local.mjs` создаёт новый immutable source snapshot текущих разрешённых файлов, оценивает context payload, проверяет COPY/embed closure, фиксирует fingerprints, validates Compose и различает отсутствие daemon. Опциональный benchmark требует работающий локальный builder и реальные digest-pinned image refs, затем выполняет cold + warm-1 + warm-2. Скрипт не deploy/push/prune, не читает application `.env`, не перезаписывает прежние результаты.
- Согласованный с root дополнительный seam: release source fingerprint в `scripts/content/micro-mvp-release-evidence.mjs` теперь включает policies, Bake/compose, worker build/server inputs, release planner и backend embed data. Исправлены устаревшие assertions в его тестах; исторические evidence файлы не переписывались.

## Измеренные оценки исходников

Это **estimated source/context payload bytes по scanner**, не Docker transferred context bytes и не размеры images. В baseline — tracked HEAD `4549fb3c903659d3fe2beb272f7f903a731f7388` с прежними ignore rules; новый snapshot включает разрешённые незакоммиченные изменения этой итерации. Baseline ручной root-сборки с локальными 10+ GiB outputs не пересканировался.

| Компонент | Старый tracked context, bytes | Новый working source context, bytes | Файлов |
| --- | ---: | ---: | ---: |
| backend | 24 304 836 | 23 633 782 | 381 |
| frontend | 280 876 256 | 166 915 480 | 1 268 |
| worker | 280 876 256 | 8 039 835 | 590 |

Подробные метрики: `REL-02-measurements.json`. Полные file hashes/COPY fingerprints: `outputs/release-measure/rel02-final-inventory/report.json`. Source/native snapshots: `outputs/release-measure/rel02-current-v3/` и финальный backend snapshot в `outputs/release-measure/rel02-final-inventory/native/backend`. Эти папки созданы этим заданием; пользовательские прежние outputs не менялись.

## Проверки и их пределы

- `node --test scripts/release/measure-local.test.mjs scripts/release/plan-components.test.mjs` — **41/41 PASS**. Положительные/отрицательные ignore paths, sensitive/local artifacts, raw Markdown, новый rules primitive, отсутствующий COPY/embed input, отдельные media/UI/lockfile fingerprints, required typecheck/lockfile/cache scopes, запрет неприкреплённых image refs.
- `node --test scripts/content/micro-mvp-release-evidence.test.mjs` — **25/25 PASS** после обновления build-input contract.
- Измеритель проверил все **5 Compose configurations** официальным Docker CLI с пустым env-file, `--no-env-resolution --no-interpolate`; build context/dockerfile path mappings корректны. Конфигурации не запускались.
- `docker buildx bake -f infra/docker-bake.hcl -f infra/docker-bake.cache-gha.hcl --print` — **PASS**, три независимых cache scopes. Это parser/configuration check, не build.
- Из чистого backend source snapshot — **PASS**, Go 1.25.12, `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w"`. Сначала проверена предыдущая копия; после параллельного изменения `roguelike_camp_inventory.go` создан и собран новый точный snapshot финального inventory. 35 Go embed patterns имеют inputs.
- Из чистой копии только worker COPY inputs — **PASS** `node worker/build.mjs`; свежий graph содержит **267 source inputs**, все присутствуют в context. Правила REL-01 также проверены самой worker build.
- Из чистой копии только frontend build-stage COPY inputs — **PASS** цепочка из `npm run build`: DiceBox source check → TypeScript → Vite → DiceBox dist check. Native Node 24.19.0, существующие установленные lockfile dependencies подключены отдельной junction: это **не чистый npm ci и не Linux Node 20 container build**. Исходники/fixtures/dist не брались из основного frontend; source snapshot не содержит node_modules. Dependency mount явно создан только для native проверки.
- Vite сообщил о runtime public URLs после разделения media; все **21 root-relative CSS asset URL** найдены в финальном объединении полного public и dist. Оба DiceBox checks подтвердили 7 canonical assets версии 1.1.4. Существующее предупреждение о крупных JS chunks сохраняется.
- Scoped `git diff --check` — **PASS**; root compose нормализованы в LF.

Native проверка нашла и помогла исправить реальную ошибку первой политики: `**/coverage` скрывала production TypeScript из `src/rules-core/coverage`. Финальная политика исключает только frontend coverage output; положительная fixture защищает это различие. Первые диагностические source snapshots сохранены как evidence разработки, но не являются финальной acceptance.

## Что остаётся обязательным

Последующий runtime alignment: локальные Docker defaults frontend/worker и Bake переведены на Node 24, соответствующий native/CI. Node 20 имеет статус EOL по [официальной таблице](https://nodejs.org/en/about/previous-releases) на дату проверки. Адресные context/build-contract tests **9/9 PASS**, `docker buildx bake ... --print` повторно PASS с `node:24-slim`. Это не actual build и не digest pin; перечисленные ниже ограничения остаются.

1. Разрешённый локальный Linux/BuildKit daemon, корректные actual runtime image digests.
2. Чистые сборки каждого компонента с dependency install: один cold и два warm, реальные Docker context transfer/cache markers/image sizes. Сейчас эти поля **null/unavailable**.
3. Проверка инвалидации UI/shared-engine/media/lockfile на самом BuildKit; текущие tests доказывают input fingerprints, но не реальные cache hits.
4. Container smoke frontend/backend/worker через завершённый TEST-01 stand, включая UI assets/preview imports. Native health других задач не подменяет эту проверку.
5. Перед будущей выкаткой — явный BuildKit preflight. Текущий production legacy builder не был автоматически переключён; старый runner без подходящего builder не сможет исполнить `RUN --mount`. Новые Dockerfiles не объявлены готовыми к production rollout до этой проверки.

Операторская инструкция и источники Docker: `docs/release-builds.md`. Откат — вернуть прежние Dockerfiles/context rules; старые образы и cache сохранены, очищать Docker для отката не требуется.
