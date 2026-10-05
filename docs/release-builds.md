# Локальная сборка компонентов

Новые Dockerfile используют BuildKit (`RUN --mount=type=cache`) и Dockerfile-specific ignore policies. Legacy builder не поддерживается ими. Текущий TimeWeb builder не изменён: перед будущей выкаткой REL-05 должен подтвердить BuildKit и выполнить чистые сборки на разрешённом стенде. Ни наличие Docker CLI, ни успешный `compose config` не доказывают работу builder.

Команды выполняются из корня репозитория:

```text
docker buildx build --load -f backend/Dockerfile backend
docker buildx build --load -f frontend/Dockerfile .
docker buildx build --load -f infra/Dockerfile.rules-worker .
docker buildx bake -f infra/docker-bake.hcl --print
```

Контекст backend — `backend/`; frontend/worker — корень репозитория. Три корневых compose-файла используют эти пути. `infra/compose.test.yml` уже соответствует им; `infra/compose.prod.yml` потребляет готовые образы и не содержит сборку. Переменная `VITE_API_URL` передаётся именно как frontend build arg: environment запущенного nginx не может изменить уже собранный JS. Для same-origin production оставлять её пустой; локальные compose без gateway используют `http://localhost:8080`.

Root `.dockerignore` задаёт безопасный общий fallback, per-Dockerfile policies разделяют frontend/worker. Разрешены production source, raw Markdown, Go embed SQL/JSON, каноничные assets и лицензии. Нельзя применять общий `**/coverage` exclusion: в `src/rules-core/coverage` есть TypeScript, нужный текущему typecheck. Только `frontend/coverage` — отчёт тестирования. Локальные `.env`, node_modules, БД, dumps в backups/tmp/outputs, тесты и прежние dist исключены. Не добавлять secrets в ARG/COPY; npm install scripts остаются выключенными.

Dependency layers используют обязательные lockfiles и `npm ci`/`go mod download`. У frontend/worker отдельные npm cache IDs, у backend — отдельные Go module/build caches. Публичные медиа frontend копируются в финальный образ отдельным слоем. Этап компиляции получает только guarded DiceBox и PWA public inputs; `npm run build` по прежнему включает TypeScript, Vite и проверку DiceBox до и после сборки. Изменение обычного медиа не должно пересобирать app stage; изменение DiceBox/PWA ресурсов намеренно затрагивает его. Финальный image содержит и полный public, и результат app stage.

## Измеритель

```text
node --test scripts/release/measure-local.test.mjs
node scripts/release/measure-local.mjs --prepare
```

Результат создаётся в новой папке `outputs/release-measure/rel02-<UUID>/`; существующие результаты не перезаписываются/не удаляются. `report.json` содержит file count, estimated source/context payload bytes, SHA256 каждого файла, fingerprints COPY inputs, замыкание Go embed, сопоставление с tracked HEAD и результаты проверки пяти Compose configs. `--baseline <commit>` меняет только сравнительный tracked baseline. `--prepare` копирует разрешённые текущие исходники, включая новые untracked source files, в отдельные contexts и проверяет, что они не изменились во время копирования. Это чистый source snapshot текущих изменений, а не `git archive HEAD` и не новый коммит. Зависимости, snapshots и результаты экспериментов в него не переносятся.

Scanner поддерживает используемое подмножество Dockerignore (`*`, `**`, `?`, ordered `!`, ancestor exclusions); неподдерживаемые character classes/escape patterns приводят к ошибке. Его bytes — оценки содержимого файлов, а не фактический объём передачи Docker с tar/protocol metadata. Он не измеряет cache hits или время сборки без daemon. Fixtures проверяют положительные и отрицательные пути, удалённый COPY/Go embed input, разделение media/UI/lockfile fingerprints. Окончательная проверка Dockerignore и Dockerfile syntax выполняется самим BuildKit на чистом snapshot; native equivalent compilation её не заменяет.

На машине с работающим локальным Docker можно явно запустить benchmark:

```text
node scripts/release/measure-local.mjs --prepare --build --builder rel02-local --images path/to/image-pins.json
```

Builder предварительно создаётся оператором локально, например `docker buildx create --name rel02-local --driver docker-container`. Измеритель принимает только Docker-backed builder с локальными endpoints; SSH/TCP/Kubernetes/remote endpoints отклоняет. `image-pins.json` должен содержать ровно публичные `GO_IMAGE`, `ALPINE_IMAGE`, `NODE_IMAGE`, `NGINX_IMAGE` с реальными `@sha256:<64 hex>` refs. Не подставлять условные digests: файл готовится по реально доступным образам разрешённого стенда. Выбранная platform по умолчанию `linux/amd64`, можно передать `--platform` явно.

Для каждого компонента выполняются один `--no-cache` и два warm build с одним snapshot/runtime pins. Новый уникальный cache namespace изолирует npm/Go mounts от предыдущих прогонов. Скрипт записывает elapsed ms, CACHED markers, image ID/size и BuildKit logs; базовые образы могут быть уже скачаны, поэтому cold означает холодный application/dependency cache, а не обязательный повторный network pull. Cache/prune и удаление образов не выполняются. Без daemon статус `awaiting_environment`, `builds: null`; числа времени/cache hits не выдумываются. Измеритель не запускает контейнеры — frontend/backend/worker smoke остаётся отдельной обязательной acceptance проверкой через TEST-01.

## Среда выполнения

Frontend и worker используют Node 24 в локальных Docker defaults, как текущий native стенд и CI. Node 20 завершил стандартную поддержку; Node 24 относится к LTS ([официальная таблица Node.js](https://nodejs.org/en/about/previous-releases), проверено 04.10.2026). Для настоящего релиза по-прежнему обязателен проверенный digest, а не плавающий tag. Перенос default не является подтверждением Linux container build: это остаётся обязательной репетицией. Старые CJS сохраняются и проверяются как прежние файлы, не пересобираются ради обновления среды.

## Внешний cache — подготовка для REL-04

`infra/docker-bake.cache-gha.hcl` — opt-in overlay для будущего gated GitHub workflow, с отдельными `bagofholding-backend`, `bagofholding-frontend`, `bagofholding-worker` scopes. Он не подключён к действующему CI, не отправляет образы и не меняет registry. Persistent layer cache и cache mounts — разные механизмы: на новом ephemeral runner содержимое npm/Go cache mounts автоматически не восстанавливается только от включения GHA layer cache. Это необходимо измерить в REL-04, а не обещать ускорение изменившегося lockfile.

Основания: [Docker build contexts и ignore policies](https://docs.docker.com/build/concepts/context/), [cache mounts и порядок слоёв](https://docs.docker.com/build/cache/optimize/), [GitHub Actions cache и отдельные scopes](https://docs.docker.com/build/cache/backends/gha/).
