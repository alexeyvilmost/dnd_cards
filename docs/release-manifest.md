# Состав релиза и происхождение компонентов

Статус 04.10.2026: локальный контракт REL-03. Runner `infra/deploy-release`
ещё использует прежнюю схему одного SHA и **не совместим** с новым digest-only
`infra/compose.prod.yml`. До REL-05, проверки настоящих Docker-образов и отдельного
запроса на выкатку применять этот Compose на сервере нельзя. Проверки текущего
Windows-окружения не заменяют Linux/container gates.

## Что идентифицируется

`infra/release-manifest.schema.json`, версия 1, задаёт единственный состав релиза:

| Поле | Значение |
| --- | --- |
| `releaseId`, `releaseCommit`, `previousReleaseId` | Идентификатор выпуска, commit проверенного кандидата, предыдущий выпуск |
| `components.{frontend,backend,rulesWorker}.sourceCommit` | Commit, из которого действительно собран этот компонент; может быть старше releaseCommit |
| `components.*.imageDigest` | Полная ссылка `repository@sha256:…`, без mutable tag; digest OCI-образа не равен artifactHash |
| `components.*.inputFingerprint` | SHA-256 исходных входов, pinned base images, архитектуры и compile args |
| `rulesArtifactHash` | SHA-256 точных байтов исполняемого worker CJS, используемого новыми боями |
| `contentManifestHash` | Хэш соответствующего проверенного каталога контента; не Git SHA |
| `workerRuntime`, protocol/schema/capabilities | Точная версия Node и явный контракт совместимости |
| `migrationSet` | Идентификаторы и неизменные хэши миграций; не команда отката БД |
| `validationEvidence` | Хэши фактических отчётов core, image-contract, pinned-artifacts для данного состава |

Сканер REL-02 возвращает `source_fingerprint` (64 hex) только входных файлов.
Для `componentInputFingerprint()` передать его как `sha256:<hex>`, точные
base-image digests соответствующего компонента, `linux/amd64` или `linux/arm64` и
публичный frontend `VITE_API_URL`. Менять Node/Go/nginx/base OS или compile URL
без изменения component fingerprint нельзя. BuildKit cache scope, номер релиза
и сами identity args в fingerprint не входят. Подтверждение соответствия
source snapshot настоящему чистому commit остаётся обязанностью REL-04 runner;
переданный build arg сам по себе ничего не доказывает.

## Встроенная и текущая идентичность

Docker build принимает `COMPONENT_SOURCE_COMMIT` и
`COMPONENT_INPUT_FINGERPRINT` вместе. Go получает значения через linker; frontend
и worker — через файл `component-identity.json`, созданный при сборке. У worker
хэш берётся из фактического CJS, а версия Node — из runtime build stage. Пустые
параметры дают явное `unverified` для локальной разработки; такой компонент не
проходит release preflight. Некорректные непустые аргументы отклоняются.

Health API и frontend `build-info.json` показывают `sourceCommit` и прежний alias
`source_commit` из встроенных данных. Worker сохраняет прежний `artifactHash`.
Runtime `SOURCE_COMMIT` больше не подменяет происхождение. Отдельные
`RELEASE_COMMIT` / `RELEASE_ID` описывают текущий выпуск. Отсутствующая Node
metadata допускается только как `unverified`; несовпадение существующей metadata
с CJS или фактическим Node прекращает запуск worker. Сам файл нельзя подменять
bind mount или переменной окружения.

Внешние старые проверки «frontend SHA = backend SHA = release SHA» применимы
только к однородным выпускам. Старый micro-MVP collector сохранён для таких
проверок; mixed release проверяется новым manifest preflight. Нельзя менять
`source_commit` ради прохождения старой проверки.

## Локальные команды и допуск

```text
node scripts/release/validate-manifest.mjs manifest.json
node scripts/release/validate-manifest.mjs old-manifest.json --legacy
node scripts/release/validate-manifest.mjs manifest.json --candidate-env
node scripts/release/validate-manifest.mjs manifest.json --preflight preflight-bundle.json
```

Все команды читают только явно указанные файлы и выводят JSON; не запускают
Docker, не пишут env-файлы, не меняют активный выпуск. `--candidate-env` выдаёт
состав **только для изолированного кандидата**. Только успешный `--preflight`
выдаёт `status: ready` для последующей отдельной операции cutover. При отказе нет
частичного env-вывода. REL-05 обязан использовать этот gate до переключения,
а не считать валидный JSON разрешением на запуск production.

Preflight bundle содержит:

- `identities`: реальные JSON endpoints трёх запущенных изолированных кандидатов;
- `images`: реальные OCI references из инспекции контейнеров/образов, не из health;
- `reports`: отчёты `core`, `image-contract`, `pinned-artifacts` со `status: passed`
  и `compositionFingerprint`; каждый `reportHash` равен `evidenceHash(report)`;
- `historicalArtifactHashes` и явное `historicalInventoryComplete: true`, полученные
  полным чтением ссылок текущих и исторических боёв, а не только последних релизов;
- `previousManifest` для не первого выпуска. Проверяются ссылка на предшественника,
  его artifactHash и неизменность уже применённых миграций.

`compositionFingerprint(manifest)` — канонический SHA-256 компонентов, контента,
миграций и требований совместимости, без времени/id выпуска и самих reports.
Отчёты — структурированный JSON, `evidenceHash()` хэширует каноническое JSON
представление, а не форматированный текст файла. Это привязка локальных
доказательств, **не подпись** доверенного CI. Доверие к источнику отчётов и реальной
инспекции контейнеров обеспечивает будущий runner; вручную написанный `passed`
не является результатом теста.

`pinned-artifacts` дополнительно содержит точный `workerRuntime`, полный список
проверенных `artifactHashes` и `pendingDecisionChecked: true`. Протокол API/worker
сейчас 1, текущая world schema 5. Эти числа не объявляют произвольный старый CJS
совместимым с новым Node: нужно запустить retained artifacts и проверить
сохранённое pending decision на том же runtime. Envelope версии 1 передаётся
старому артефакту без обновления состояния/кости/ресурсов.

`scripts/release/check-frontend-identity.mjs` — явный POSIX gate: выполняет
настоящий shell writer с baked fixture, новым release ID и ложным SOURCE_COMMIT,
проверяет атомарную замену и отказы. Требуется Linux/macOS; на Windows команда
завершается отказом «среда недоступна». В основном Node suite нет скрытого skip.
Этот shell gate всё равно не заменяет запуск финального nginx-образа.

## Откат и хранение

Откат использует прежние совместимые **digests**, с новым manifest/identity gate,
при текущем наборе миграций. Если новые миграции несовместимы со старым backend,
откат запрещён до отдельного плана совместимости; восстановление БД автоматически
не выполняется. Старые истории, CJS и pending decisions не переписываются.

`retentionReferences()` объединяет изображения всех retained manifests и hashes
текущих/исторических боёв. Функция только показывает ссылки и всегда возвращает
`authorizesDeletion: false`: даже пустой список не разрешает GC. Исторический бой
защищает свой CJS независимо от возраста release. Frontend chunks, используемые
открытыми страницами, также требуют отдельной retention-политики. Старый GC
runner «оставить пять релизов» не подходит для смешанных компонентов до REL-05.

## Непроверенные границы

В текущем окружении Docker daemon недоступен. Реальная сборка, nginx startup,
OCI inspection, запуск смешанных Linux-образов и cutover/rollback локального
Compose ещё не подтверждены. Юнит-тесты валидатора проверяют отказы на fixtures;
worker HTTP tests проверяют реальный локальный транспорт и retained CJS. Они не
выдают production-ready manifest и не доказывают совместимость всех артефактов
на сервере. Реальный текущий manifest не создавался, CI/registry/TimeWeb не менялись.
