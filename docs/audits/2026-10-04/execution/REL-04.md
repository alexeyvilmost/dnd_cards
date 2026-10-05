# REL-04 — подготовленный CI immutable images

Статус: `prepared_awaiting_environment_and_dependencies`. Это не завершённый
acceptance. REL-02/03 Docker checks и полный TEST-03/04 integration gate ещё
не закрыты. Workflow не включён, build config `enabled:false`, реальные pins
и production content/migration identities не выдуманы. Commit/push, registry
publication, GitHub settings/secrets/environments и TimeWeb не изменялись.

## Реализовано локально

- Новый `.github/workflows/release.yml`: только manual dispatch на main, exact
  candidate SHA, проверенный успешный `ci.yml` run того же репозитория/коммита;
  PR/fork/другой workflow и непрошедший run не принимаются. Control checkout
  закреплён за dispatch SHA, application source — за candidate SHA.
- `scripts/release/ci-release.mjs`: проверка настоящего отчёта shared runner
  (`local-api-spine`, `local-browser-flows`, source hygiene и завершённый cleanup),
  чистого source checkout/main ancestry, REL-01 selection, Docker source closures
  и fingerprints. Baseline — receipt + manifest из последнего успешного main
  deployment run; metadata verification хранится отдельно от его artifact.
- Reuse требует неизменившегося dependency scope и полного inputFingerprint:
  source, base image digests, platform и public frontend compile args. Сохраняются
  старые component sourceCommit/imageDigest; releaseCommit меняется отдельно.
  Неизвестный путь включает безопасную полную сборку. Tampered/rehashed plan,
  config drift, придуманный reuse и неоднозначный baseline отклоняются.
- `infra/release-build-config.json`: отключённая конфигурация, строгий набор
  GO/ALPINE/NODE/NGINX и BuildKit digest pins, только Linux amd64, content hash и
  уникальные immutable migration identities. Неизвестные значения требуют
  заполнения после проверки, перед любой сборкой.
- `scripts/release/ci-images.mjs`: component build outputs; actual Docker image
  identity inspection без внешней сети/БД; image archive SHA-256 и image ID;
  отдельный явно включаемый publish CLI. Все records/archive hashes проверяются
  до первого push. Изменившийся образ загружается из тех же проверенных байтов;
  новый digest берётся из реального Docker RepoDigests. Reuse реально делает pull.
- Additive backend `--build-info` выходит до env/DB init. Frontend inspection
  выполняет настоящий POSIX writer, worker читает baked metadata и actual CJS,
  поднимает loopback health. Подставленный runtime SOURCE_COMMIT не должен менять
  component identity. Это image inspection, не full application/DB health gate.
- Параллельная matrix из трёх компонентов, независимые GHA layer-cache scopes.
  Build jobs имеют package read и не публикуют. Единственный publish job получает
  package write после всех component jobs и отдельной variable/environment.
  Production/SSH credentials в workflow отсутствуют; настройки не создавались.
- Artifact `release-candidate` честно содержит `candidate-only`, `deployable:false`.
  Состав привязан к CI evidence и image records. Без actual full candidate health,
  image-contract, полной historical inventory и pinned compatibility REL-03
  readiness validator его не принимает. Частичный push не выдаёт ready manifest
  и не запускает удаление образов/истории.
- `docs/release-ci.md` описывает отключённый внешний этап, ограничение GitHub plan
  для environment protections, baseline contract и следующий локальный OCI drill.
  Source fingerprint collector включает новые workflow/config/tooling inputs.

## Фактические проверки

1. `node --test scripts/release/ci-release.test.mjs scripts/release/validate-manifest.test.mjs scripts/release/measure-local.test.mjs scripts/content/micro-mvp-release-evidence.test.mjs`
   — **52/52 PASS, 0 skips, 0 TODO**, 6.46 s. Среди них 8 новых CI tests:
   exact CI identity/report, mandatory browser/API, duplicate/missing checks,
   disabled/invalid immutable config, clean main ancestry, reuse, source/record/
   archive/config/baseline tampering, publication disabled, candidate not ready,
   настоящий YAML parse и permissions/conditions/action pin contracts.
2. После расширения fixture сценария UI-only повторён
   `node --test scripts/release/ci-release.test.mjs` — **8/8 PASS**, 0 skips.
   Изменение `frontend/src/pages/Screen.tsx` собирает frontend, backend/worker
   сохраняют старые sourceCommit/digest; shared runtime затем выбирает worker.
   Временные Git fixture repositories удалены в teardown; рабочий Git не коммитился.
3. `go test . -run '^(TestBuildIdentityCommand|TestComponentBuildIdentity)$' -count=1`
   — PASS (локальный Go 1.25.12), current backend собирался. Два теста подтверждают
   прежний identity contract и новый CLI без изменения обычных argument paths.
4. Scoped `git diff --check` — PASS. Новая `.github/workflows/release.yml`
   разбирается `js-yaml`; `.github/workflows/ci.yml` в этой задаче не изменялся.
5. Action commit refs проверены read-only `git ls-remote` официальных repositories
   04.10.2026. Закреплены checkout/setup-node/upload/download-artifact v4,
   setup-buildx/login v3, build-push v6; Buildx 0.36.1, tooling Node 24.19.0.
   Это проверка существования выбранных refs, не утверждение о последних версиях.

Предшествующий owned DB-only слой TEST-03: **686/686** выбранных Go tests прошли
в `test_2869395c337b56c6b3d189c7`, cleanup stopped. Он предшествует добавлению нового
CLI test и не заменяет текущий общий gate. Подробности —
`TEST-03-backend-regressions.md` и `TEST-03-extended-go-final.json`.

## Непройденный acceptance и следующие действия

- Docker daemon недоступен (ранее подтверждённый WSL virtualization block).
  В REL-04 новых попыток Docker build/start/registry не выполнялось. Поэтому
  build/save/load/push/pull, actual image metadata, cache hits и времена сборки
  **не проверены**. Unit records/фикстуры не выдаются за эти проверки.
- Обязателен отдельный owned loopback OCI registry drill: actual three images,
  changed component publish, old digest reuse, failed/missing image/layer/manifest,
  corrupt archive и повтор выпуска. Локальный registry adapter/fixture ещё требует
  реализации и выполнения при доступном daemon; текущий CLI предназначен для
  отключённого GHCR workflow. Публикация в GHCR не заменяет локальный rehearsal.
- На exact committed source нужен настоящий успешный TEST-03/04 CI report с
  реальными browser/API checks. Такой GitHub report сейчас не создан. Настройка
  и запуск GitHub stages требуют отдельного явного запроса после локального gate.
- Environment approval rules нельзя предполагать без проверки repository plan
  и visibility. Registry выбор/pull access TimeWeb/credentials — внешний этап,
  который здесь не выполнялся. Config и variables оставлены выключенными.
- Сгенерированный candidate запрещено передавать напрямую старому deploy runner.
  REL-05 обязан добавить isolated candidate health, historical/pending validation,
  сверку actual active baseline перед cutover и безопасный rollback. Старые CJS,
  receipts, manifests и image digests не удаляются.

Основания: [Docker: обмен image artifacts между jobs](https://docs.docker.com/build/ci/github-actions/share-image-jobs/),
[Docker: GHA cache и cache-mount ограничения](https://docs.docker.com/build/ci/github-actions/cache/),
[GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
Проверены 04.10.2026; standalone source checks не доказывают работу remote CI.
