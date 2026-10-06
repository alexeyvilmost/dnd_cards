# Ограниченное согласование последнего main

Этот follow-on дополняет selective release. Новый путь выключен, пока `AUTO_RECONCILE_MAIN_ENABLED` не установлен ровно в `true`. Также требуются `RELEASE_BUILD_ENABLED`, `AUTO_RELEASE_MAIN_ENABLED`, `RELEASE_PUBLICATION_ENABLED`, `PRODUCTION_DEPLOY_ENABLED`, `AUTO_DEPLOY_MAIN_ENABLED` и tracked policy `productionEnabled:true`, `autoDeployMain:true`. Отсутствующая либо иная строка любой variable запрещает dispatch. Переключатели не меняют host config, writer policies или правила.

## Сценарий A/B/C

1. A начинает переключение от D. Пока A работает, более новый B может успешно провериться и опубликовать кандидат B(D).
2. После успешного A сериализованный prepare B повторно получает последний фактически выложенный manifest. B(D) становится `superseded`, job `deploy` пропускается. Host не посещается; discovery не получает ложную неуспешную попытку cutover.
3. `reconcile.yml` получает completed success A, проверяет настоящий `deploy` job и единственный неистёкший `deployed-release` artifact его latest attempt. Зелёный workflow с skipped deploy не подходит. Настоящий failed/cancelled/unknown cutover, отсутствие или порча evidence блокируют процесс.
4. Если main уже B, отдельная immutable claim связывает repository, SHA B, deployed run/attempt и hash manifest A. Единственный POST запрашивает полный `ci.yml suite=extended` на main. Опубликованный B(D), предыдущая CI и receipts остаются прежними. Новая успешная CI создаёт новый B(A); при full planning используется canonical full path, даже если текущий diff потенциально UI-only. Старый selective/core report нельзя переименовать в этот proof.
5. Если latest main уже C при planning, проверяется C. Если C появляется перед POST, B не запускается; обычный push CI C начался после фактического завершения A и может получить его baseline. Если main меняется между POST и созданием CI, ранний request guard отклоняет несовпадающий source; обычный push CI C остаётся самостоятельным событием. Уже начатые host операции не отменяются.

Перед POST ещё раз читаются latest actual deployment и HEAD. Перед CI workload проверяются main, точный SHA, suite extended, настоящий trusted coordinator, attempt и immutable claim artifact. Ordinary/manual core runs не являются marker дедупликации. Вызов coordinator не имеет ручных inputs, host credentials, environment production или package write permission. Единственная write-возможность — Actions dispatch полного CI. Исходники берутся из trusted main control, а не из downloaded candidate.

## Ограничение и восстановление

Максимум один автоматический POST на coordinator actual-deployment event. Tuple claim включает deployed run/attempt/manifest и HEAD. Повторный coordinator attempt или дублирующий более поздний workflow для того же predecessor не отправляет запрос заново, в том числе если предыдущая попытка упала. Это более консервативно, чем дедупликация только успешных POST.

Новая цепочка не обещает безусловную eventual convergence. Сбой после публикации claim и до принятия POST, потеря ответа, отменённая CI, превышение API history bound либо отказ Actions могут оставить main невыкаченным. Даже HTTP204 означает принятие запроса CI, а не успешную CI/выкатку. Сбой сохраняет claim и failure; повтор workflow не превращает неизвестный результат в успешный и не отправляет blind retry. История ограничена 999 запусками выбранного workflow; усечение/неполная пагинация не приводит к догадке о baseline.

Оператор сначала проверяет последний фактический deploy job/receipt и host journal, затем ищет уже созданный точный CI run. При неизвестной/неуспешной host операции действует обычная процедура recovery; этот workflow её не обходит. Если host имеет подтверждённую успешную версию, автоматический запрос CI не завершился и требуется продолжение, можно явно запустить обычный `ci.yml` на текущем main с `suite=extended` и пустым `reconcile_request`. Это новый полный verification request после осмотра состояния, а не rerun опубликованного старого candidate. Последующий release/deploy снова проверяет актуальный predecessor. Удалять claim ради повторного dispatch не нужно.

Docs/tests-only no-op не двигает deployed baseline. Его skipped deploy не запускает дополнительную выкатку; будущий diff по-прежнему считается от последнего фактически выложенного manifest.

## Что подтверждено и что ещё требуется

Локальные unit/contract тесты моделируют быстрые A/B/C push, stale skip, failed-host refusal, отсутствие/порчу evidence, lost POST, rerun, fork/source/suite/attempt mismatch, полную проверку вместо старого core и disabled policy. Read-only metadata настоящего GitHub artifact подтверждает используемую форму `workflow_run.id/head_sha`; поле artifact `run_attempt` не предполагается. Docker/application execution нового кода не требуется: он не изменяет application или host adapter.

Hosted acceptance ещё не выполнен. После согласованного включения в тестовом репозитории нужны настоящие success A + queued B(D), skipped stale deploy, один новый extended CI с immutable claim, automatic release B(A) и actual successful deploy; отдельно C supersession, no-op и unknown POST без повторной отправки. После этого отдельно принимается production enablement. Ни mock metadata, ни локальные 248 contract assertions не считаются этим proof.

GitHub допускает три уровня `workflow_run`: CI → release → deploy → reconcile укладывается в этот предел; новый `workflow_dispatch` разрешён для `GITHUB_TOKEN`. Это задокументированная основа, но фактическую цепочку требуется проверить hosted: [workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [GITHUB_TOKEN events](https://docs.github.com/en/actions/concepts/security/github_token). [Workflow run API](https://docs.github.com/en/rest/actions/workflow-runs) ограничивает filtered searches 1000 результатами; наш fail-closed предел ниже.
