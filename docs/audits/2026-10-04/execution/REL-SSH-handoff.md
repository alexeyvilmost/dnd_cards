# Передача выкатки через SSH из hosted GitHub Actions

Пользователь разрешил commit/push и выкатку после локальной проверки. Дополнительного разрешения на включение этого пути не требуется. Фактическую установку ключа, конфигурацию GitHub/сервера, commit/push и запуск выполняет root. Этот документ не утверждает, что выкатка уже состоялась.

Репозиторий публичный. Production-capable self-hosted runner не устанавливается: `deploy` работает на `ubuntu-24.04`, получает отдельный SSH-ключ только из environment `production`, ограниченного main. Обычные PR jobs не получают ключ, Docker socket или production env. Branch protection и environment rules остаются административной границей, которую проверяет root.

## Подтверждённая среда и точные настройки

Root проверил TimeWeb: Ubuntu 24.04.4, amd64, glibc 2.39, около 23 GB свободного диска. Перед установкой проверяются текущие `uname -r`, свободный диск, локальный Docker daemon/Compose и исполнение закреплённого Node. Node 24 GNU/Linux x64 требует kernel ≥4.18, glibc ≥2.28 и libstdc++ ≥6.0.25; Ubuntu 24.04 удовлетворяет указанной платформенной базе, но фактический бинарник проверяется отдельно. [Официальные требования Node 24](https://raw.githubusercontent.com/nodejs/node/v24.x/BUILDING.md).

Hosted jobs используют Ubuntu 24.04 и `setup-node` 24.19.0. Host bootstrap требует **ровно 24.19.0** в `DEPLOY_SSH_NODE`; образ gateway с Node 24.21.0 ему не подставляется. Git/Python на host для SSH транспорта не нужны: архив проверяет ограниченный Node parser. Docker/Compose, существующие production env и доступ к GHCR нужны последующим прежним gates. Сам transport не скачивает и не устанавливает программы. Общие требования GitHub к Linux/исходящему HTTPS документированы отдельно; production runner здесь не используется. [GitHub runners](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).

| GitHub setting | Значение/смысл |
|---|---|
| production secret `DEPLOY_SSH_PRIVATE_KEY` | Отдельный CI-ключ; не персональный deploy key. Root уже сохранил secret, регистрацию public key выполняет отдельно. |
| production secret `DEPLOY_SSH_KNOWN_HOSTS` | Проверенный host key, не результат безусловного `ssh-keyscan` во время job. Root уже сохранил secret. |
| `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_PORT` | Проверенный endpoint и выделенная учётная запись; порт 22 допустим по умолчанию. |
| `DEPLOY_SSH_ATTEMPT_ROOT` | `/opt/bagofholding/deploy-attempts`, существующий защищённый каталог 0700. |
| `DEPLOY_SSH_NODE` | `/opt/bagofholding/deploy-tools/node`, проверенный Node 24.19.0. |
| `DEPLOY_HOST_CONFIG_FILE` | Абсолютный путь к проверенному host JSON вне checkout/attempt. |
| `REHEARSAL_CONFIG_FILE` | Абсолютный путь к шаблону rehearsal JSON вне checkout/attempt. |
| `RELEASE_BUILD_ENABLED`, `RELEASE_PUBLICATION_ENABLED` | Включать после pins/config и успешного точного CI; публикация имеет отдельный environment `release-publication`. |
| `PRODUCTION_DEPLOY_ENABLED` | Включать вместе с `infra/deployment-policy.json.productionEnabled` после проверок host/rollback. |
| `AUTO_RELEASE_MAIN_ENABLED`, `AUTO_DEPLOY_MAIN_ENABLED` | Включать после первой успешной ручной legacy adoption; auto deployment дополнительно требует policy `autoDeployMain:true`. |

Host config остаётся прежним строгим контрактом: `schemaVersion:1`, `project`, абсолютные `root`, `composeFile`, `caddyFile`, `deployEnvFile`, `appEnvFile`, `workerEnvFile`, `artifactDirectory`, `assetDirectory`, `backupDirectory`, `migrationBaselineFile`; pinned `postgresImage`, `composeHash`, `caddyHash`. Для первой adoption нужен `legacyBaselineDirectory` с проверенным observed baseline/rollback config. Базовый `backupDirectory` — ровно `<root>/backups`; wrapper создаёт `capture-<run>-<attempt>` и отдельный private host config с указателем на **этот** capture. Шаблон rehearsal: `schemaVersion:1`, тот же `postgresImage`, `activeStateFile`, совпадающий с `deploymentStateFile(hostConfig)`. Статический старый backup не подставляется.

## Порядок root

1. Закончить observed migration identity/known-retired ledger review и все обязательные локальные проверки на одном source snapshot. Pins base images/BuildKit, content hash и migration identity заполнить по фактическим байтам, не предположениям. Проверить локальный OCI/restore acceptance. Конфигурация disabled остаётся проверкой готовности, не запросом нового разрешения.
2. Установить проверенный Node 24.19.0 по указанному пути. Зарегистрировать отдельный public SSH key с запретом forwarding/PTY. Проверить SSH host key по доверенному уже существующему каналу. Проверить права 0700/0600 на host config, env, attempts, backups; эти каталоги не входят в workspace/artifact upload.
3. Проверить `production` environment main-only, оба SSH secrets, перечисленные vars и packages permissions. Self-hosted runner не регистрировать. Публикация GHCR выполняется hosted job; на host приходит только короткоживущий `GITHUB_TOKEN` с read permissions, через stdin, без сохранения в transfer/archive.
4. После локального PASS root делает commit/push. Дождаться exact-source CI artifact `local-suite-results`; частичные shard receipts релиз не принимает. Включить build/publication конфигурацию и соответствующие vars. Первый `release.yml` dispatch: `candidate=<точный SHA>`, `verification_run_id=<успешный CI>`, `baseline_run_id` пуст только при отсутствии предыдущего manifest deployment, `publish:true`.
5. После published candidate и host readiness включить production policy/variable, выполнить `deploy.yml` dispatch `release_run_id=<release run>`, `adopt_legacy:true`. Automatic adoption запрещена. Host должен проверить сохранённый predecessor; отсутствие manifest не означает пустой сервер.
6. Workflow сам переносит чистый `git archive` точного control SHA и четыре candidate JSON. На host: повторный **GitHub API verify-run** → provenance → актуальность auto candidate → temporary GHCR login → fresh capture → isolated candidate rehearsal → assembler → final handoff → повтор актуальности → прежний `deploy.mjs adopt/apply` → receipt. Все lock/DDL/ledger/health/artifact/history/rollback gates сохранены.
7. Принять только `deployment.status:succeeded`, совпадающие release/source/control/hash и фактическую service health. В GitHub загружаются только `deployed-release/manifest.json` и `deployment.json`. Затем включить auto variables/policy; следующий успешный main CI продолжит цепочку без ручной сборки. Проверить реальный frontend-only выпуск/reuse/rollback по исходному acceptance, не объявлять их доказанными одним transport test.

## Потерянный SSH ответ

Нельзя слепо повторять apply. Новый attempt не перезаписывает старый. Root читает private `deploy-<run>-<attempt>/phase-*.json`, `deployment-operation.json` и существующий host deployment journal. Используются прежние `deploy.mjs status <root>` и после установления фактического состояния `recover`/`rollback` с исходным capture/config. Transport не вводит force/retry mode. Обрыв до окончательного receipt не загружает successful artifact. При штатной ошибке удаляются hosted key files и attempt `docker-auth`; backup/journal сохраняются. SIGKILL/потеря хоста может оставить private временный Docker config: токен краткоживущий, перед возобновлением root удаляет только credential directory этого проверенного attempt, не старую host Docker авторизацию.

## Устаревшие формулировки в старых runbooks

`docs/release-ci.md` всё ещё описывает только manual trigger, отсутствие cutover и необходимость нового внешнего поручения; `docs/release-automation.md` требует self-hosted runner; `docs/release-deployment.md` и `infra/deploy-release` содержат прежнее «будущий/отдельный запрос». Эти утверждения о разрешении и транспорте устарели после нового поручения и SSH реализации. Реальные disabled flags/policy до readiness сохраняются. Старые OCI/native receipts остаются историческими доказательствами, их нельзя переписать утверждением о фактически состоявшейся выкатке.

## Локальные доказательства

`node --test scripts/release/ssh-transport.test.mjs scripts/release/deployment-handoff.test.mjs scripts/testing/suites.test.mjs`: **27/27 PASS**, без пропусков. Проверяется настоящий временный Git archive с длинным Unicode/PAX путём, checksum/PAX commit, отказ traversal/symlink/hardlink/duplicate/PAX alias и symlink attempt root, точный порядок всех host gates, fresh GitHub metadata, cleanup на каждой ошибке и при прерывании во время записи авторизации, завершение локального child до возврата timeout/output-limit, отсутствие retry/публикации при неполном receipt и hosted/environment wiring. Итоговая квитанция повторно проверяет schema/status/release ID, source/control SHA и hash валидного manifest на обеих сторонах. Лог: `outputs/testing/ssh-transport-current.log`, receipt: [REL-SSH-handoff.json](REL-SSH-handoff.json).

Эти unit/fault проверки не заменяют реальную SSH/TimeWeb выкатку; её результат добавляет root после выполнения. Исходные completion-аудиты не переписаны. Три обязательных среза REF-01/Solo pending/shards в `completion-followup.json` и соответствующие scope в `progress.json` отмечены как `targeted_passed_full_suite_pending`, с отдельными адресными доказательствами; старый общий PASS не выдан за проверку нового транспорта и последних правок.
