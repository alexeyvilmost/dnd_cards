# CI образов и выборочная доставка

Статус 05.10.2026: полный CI9 на `cfe9e54d` и реальная публикация трёх immutable
образов успешны. Manual build/publication/deploy variables включены; auto-main
выключен. Первая host rehearsal остановлена до cutover после истечения свежести
снимка; исходная версия `4549fb3c` здорова, все временные ресурсы очищены.
Пользователь разрешил выпуск и автоматику после проверок. [Точные результаты и
границы доказательства](audits/2026-10-04/execution/CI-09-first-publication.md).

## Как устроен pipeline

`.github/workflows/release.yml` поддерживает ручной `workflow_dispatch` и
`workflow_run` после успешного CI в `main`, когда включены соответствующие variables.
Нужны точный candidate SHA и номер успешного `ci.yml` run. Первый job
через read-only GitHub API проверяет workflow path, репозиторий/не fork, event,
ветку, conclusion и **тот же** commit. Из артефакта `local-suite-results` проверяет
реальный `report.json`: passed core/extended, mode=ci, успешные `source-hygiene`,
`local-api-spine`, `local-browser-flows`, завершённый cleanup. Legacy-manual,
пропущенный browser gate, зелёная проверка другого SHA или PR run не подходят.

Control scripts checkout закреплён за `github.sha` самого dispatch; build source
checkout отдельно закреплён за candidate. Чистота исходников, точное HEAD и
принадлежность `origin/main` проверяются перед планированием; входы каждого
контекста — ещё перед/после image verification. Движущийся main не перечитывается
посреди сборки. Actions закреплены за commit SHA; Buildx — v0.36.1, Node tools —
24.19.0. BuildKit и четыре base images должны быть pinned digest в config.

Planner REL-01 сравнивает candidate с последним успешно выкаченным manifest.
Дополнительно проверяется `inputFingerprint` (source files, toolchain pins,
platform, public frontend compile args). Unchanged image допускается к reuse
только при совпадении fingerprint и отсутствии влияния согласно planner. Reuse
job действительно делает pull и проверяет baked identity; отсутствующий image
останавливает job, не заменяется mutable tag. При отсутствии baseline все три
компонента собираются заново. Неизвестные изменённые пути дают безопасный полный
build. Worker rules artifact и transport source различаются в metadata.

Три jobs идут параллельно с отдельными GHA cache scopes. Это **layer cache**,
а не обещание переноса npm/go cache-mount между ephemeral runners. Каждый новый
образ сначала загружается локально; публикации в build jobs нет. В `network=none`
проверяется actual image: backend `--build-info` выходит до env/DB init; frontend
исполняет настоящий POSIX writer; worker поднимает свой loopback health, проверяя
CJS и Node runtime. Ложный runtime SOURCE_COMMIT не должен изменить provenance.
Затем Docker archive и SHA-256 сохраняются как artifacts. Это проверка image
identity; полноценный backend startup/DB health остаётся REL-05 candidate gate.

Отдельный publish job получает `packages: write` только после **всех** component
jobs. Проверяет records/архивы до первого push, загружает именно проверенные
байты, сверяет image ID, получает реальные RepoDigests после push. При частичном
отказе отдельные images могут остаться в registry, но успешный manifest не
публикуется и GC не запускается. Повтор строится вокруг exact source/fingerprint
tags и digests; существующие matching component records не перезаписываются.

`release-candidate` artifact содержит `candidate.json`, `manifest.json` и
`core-report.json`. Состав честно имеет `status: candidate-only`, `deployable:false`.
Сам manifest версии 1 содержит только доказанный core report; readiness validator
REL-03 отклоняет его без full candidate health, image-contract, полной исторической
инвентаризации и pinned-artifact compatibility. `core-report` связывает точный
GitHub run/report и component image records с composition fingerprint. Это
проверяемое происхождение CI artifacts, не криптографическая подпись SLSA/Sigstore;
такая подпись отдельным этапом здесь не заявляется.

## Контракт baseline для REL-05

`baseline_run_id` ссылается на **последний успешный** main run будущего
`.github/workflows/deploy.yml`, artifact `deployed-release`:

- `manifest.json` — строгий REL-03 manifest;
- `deployment.json` — `{schemaVersion:1,status:"succeeded",releaseId,releaseCommit,controlCommit,manifestHash}`,
  где hash вычислен `evidenceHash(manifest)`.

Read-only GitHub metadata отдельно хранится вне downloaded baseline directory,
поэтому artifact не может переписать проверку своего workflow origin. Совпадение
application releaseCommit/receipt/releaseId/hash обязательно; controlCommit должен
равняться SHA самого deployment workflow (workflow_run может стартовать на более
новом main). Отсутствующий artifact, manifest
или receipt — отказ, а не переход к угадыванию базы. Пустой baseline разрешает
только начальный full build; REL-05 всё равно обязан сверить активный manifest
непосредственно перед cutover и не объявлять такой выпуск первым при уже
существующем deployment/history. Deploy workflow с включённым ручным запуском и выключенной автоматикой описан в
`docs/release-deployment.md`; реальный successful baseline ещё не создан:
публикация успешна, первая выкатка не прошла полную репетицию.

## Порядок включения

1. Используется GHCR namespace `ghcr.io/<owner>/<repo>/<component>`; три реальные
   packages созданы публикацией 37272499962. Для другого registry нужен явный
   adapter/config review; publication не заменяет host acceptance.
2. Заполнить `infra/release-build-config.json`: `enabled:true`, реальные immutable
   GO/ALPINE/NODE/NGINX и BuildKit digests, проверенный contentManifestHash и
   migrationSet. Конфигурация уже заполнена проверенными digest и наблюдённым
   историческим ledger; новые миграции имеют настоящие checksums, старым они не
   приписываются. Content manifest описывает исходные данные репозитория, а не
   редактируемую production БД. Поддерживается только Linux amd64; ARM rollout не
   заявляется. Публичный compile URL не должен содержать credentials.
3. После commit/push и успешного exact-source CI отдельно включить repository
   variable `RELEASE_BUILD_ENABLED=true`. Для публикации дополнительно нужны
   `publish:true`, `RELEASE_PUBLICATION_ENABLED=true`, environment
   `release-publication` и согласованные package permissions.
4. Настроить защиты environment в пределах реально доступного GitHub plan и
   visibility; не предполагать наличие required reviewers. Build/publish не
   получают SSH/TimeWeb/production DB credentials. Репозиторий публичный: deploy
   запускается на hosted runner и подключается отдельным SSH-ключом из environment.
5. Первый production переход выполняется вручную с `adopt_legacy:true`, после
   обязательной репетиции backup/restore/rollback. После успешного принятия
   включаются auto-main policy/variables. Candidate-only artifact сам по себе
   не разрешает замену приложения.

## Локальная проверка и остающийся rehearsal

```text
node --test scripts/release/ci-release.test.mjs scripts/release/validate-manifest.test.mjs
```

Tests создают отдельные временные Git repositories; рабочий репозиторий не
коммитится. Проверяются source drift, main ancestry, exact CI identity, no fork,
mandatory E2E, false/unknown config, reused old source, changed component,
tampered archive/record/plan, candidate-not-ready и отключённый publish path.
YAML разбирается настоящим parser, action refs и границы permissions проверяются.

Обязательный следующий Docker/OCI rehearsal выполняется только на локальном
daemon: digest-pinned registry на loopback со случайным свободным портом и новым
owned volume; три builds и identity gates; save/load/push/pull проверенных байтов
в этот registry; изменение UI с reuse старых backend/worker digests; повтор
выпуска; missing manifest/image/layer и corrupted archive; доказательство, что
каждый отказ не выдаёт ready manifest. Не использовать GHCR publish job как
замену локального rehearsal. Этот набор прошёл на отдельном локальном Git fixture
с настоящими образами и реестром; результаты не объявляются CI-подтверждением
будущего коммита. Репетиция миграций/отката приложения учитывается отдельно.

Основания технического устройства: [GitHub workflow syntax и permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[Docker GitHub Actions](https://docs.docker.com/build/ci/github-actions/),
[GHA cache](https://docs.docker.com/build/ci/github-actions/cache/),
[передача образов между jobs](https://docs.docker.com/build/ci/github-actions/share-image-jobs/).
Action commit refs проверены read-only `git ls-remote` официальных репозиториев
04.10.2026; никакой remote workflow при подготовке не запускался.

После первого отказа подготовлен явный manual first_adoption_recovery для точной попытки 37273035754-1. Он требует trusted control proof, полного CI, всех трёх новых images и свежей проверки main/истории/защищённого host до capture и под lock. Успешного predecessor ещё нет; старый capture и failed rehearsal не заменяют новый bundle. Обычный deployed discovery не изменён. [Локальная интеграция](audits/2026-10-04/execution/REL-06-thin-recovery.md).

CI10 и публикация bf79 успешны; второй actual deploy37287164307 отказал до capture из-за root0755. Точный существующий root исправлен на0700, read-only original-host guard и healthPASS. История обоихfailedactual attempts сохраняется, следующий manual recovery должен явно связать обе проверенные попытки. AUTO/selective/writersOFF; новый source требует нового exactCI и свежего полного bundle. [Точная запись](audits/2026-10-04/execution/CI-10-second-publication.md).

Исправление Go JSONMap boundary прошло полный replay оригинального локального снимка136/136 и локальные33+27проверки. Trusted proof связывает все три failed attempts; следующий выпуск требует нового exactCI/images/fresh30minute capture и всех обычных gates. Первого healthy adoption ещё нет. [Подробности](audits/2026-10-04/execution/REL-06-go-wire-recovery.md).
