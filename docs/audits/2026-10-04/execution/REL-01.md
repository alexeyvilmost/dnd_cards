# REL-01 — единый выбор затронутых компонентов

Статус: реализовано локально, 04.10.2026. Production, TimeWeb, remote workflows, commit и push не выполнялись. Исходный HEAD приложения — `4549fb3c903659d3fe2beb272f7f903a731f7388`; в рабочем дереве одновременно выполняются другие разрешённые задачи, поэтому приведённые проверки относятся к scope REL-01, а не ко всему будущему релизу.

## Изменения

- `scripts/release/component-dependencies.json` — общий versioned manifest правил выбора frontend/backend/worker/infrastructure. Учитываются общий engine/rules-core/character/roguelike, backend animation/audio catalogs, package lock/tsconfig, build/release tooling, UI и production raw Markdown. Неизвестный source path включает все компоненты.
- `scripts/release/plan-components.mjs` — planner для local, CI и будущего deploy. Выдаёт resolved SHA, baseline provenance, изменения с origin/status, компонентные flags и причины. Использует NUL-delimited Git output; удаления и оба конца rename не теряются. Local добавляет staged/unstaged/untracked; CI сравнивает только указанный commit range.
- Deploy mode требует exact candidate SHA, совпадающий с чистым tracked HEAD, и manifest последнего успешного deploy. Каноничный ключ — `releaseCommit`. `release_sha`/`source_commit` поддержаны как явно помеченные legacy adapters; несколько identity keys и failed deployment status отклоняются. Свежий `origin/main` и `HEAD^` не используются вместо deployment baseline.
- Local/CI без доступного явного baseline выбирают все компоненты с объяснением. Это защищает от пустого diff после push или отсутствующего commit в shallow checkout. Для узкого локального набора нужно передать `--base` / `-BaseCommit` осознанно.
- `scripts/release/quick-gate.ps1` использует planner. Worker-only checks вынесены из frontend branch, Go ищется только для backend checks, удалённые TS/test files не передаются lint/test runner, `--passWithNoTests` убран.
- `.github/workflows/ci.yml` сохраняет существующие frontend/backend focused проверки, выбирает их через тот же planner и добавляет worker build/HTTP/replay checks. Planner проверяется всегда; его JSON сохраняется как CI artifact. Workflow не запускался удалённо.
- `frontend/worker/build.mjs` проверяет реальный esbuild source graph против общего manifest и сохраняет `worker/dist/build-inputs.json`/`metafile.json`. Новая зависимость worker, объявленная только UI, ломает worker build, пока граница не исправлена явно. Optional graph evidence в planner может только добавлять worker, никогда сокращать набор по старому графу.

## Выполненные проверки

| Проверка | Результат |
| --- | --- |
| `node --test scripts/release/plan-components.test.mjs` | 32/32 pass, 0 skipped, около 8,0 с в последнем прогоне |
| `node worker/build.mjs` из frontend | pass; реальный граф 263 source inputs покрыт manifest |
| `node --test worker/server.test.mjs worker/replay.test.mjs` из frontend | 5/5 pass, 0 skipped, около 3,2 с |
| PowerShell AST parse `scripts/release/quick-gate.ps1` | pass |
| YAML parse `.github/workflows/ci.yml` через установленный `js-yaml` | pass; planner step присутствует |
| `git diff --check` для изменённых tracked файлов REL-01 | pass |
| `node scripts/release/plan-components.mjs --mode local --base HEAD --output outputs/release-gate/component-plan.json` | pass; текущие release-tooling изменения ожидаемо выбрали все компоненты |

Integration tests создают собственные временные Git repositories и fixture objects; index, refs и commits рабочего репозитория приложения не изменяются. Проверены staged/unstaged/untracked, deletion, rename между компонентами, Unicode/space filenames, missing base, explicit full fallback, docs-only, накопленный diff после провалившегося deploy, `origin/main == HEAD`, dirty deploy checkout, разные HEAD/candidate, ambiguous manifest, additive stale graph и CLI JSON/GitHub output.

## Использование

```powershell
# Локальные изменения относительно выбранного baseline плюс рабочее дерево:
node scripts/release/plan-components.mjs --mode local --base <verified-baseline-sha>
scripts/release/quick-gate.ps1 -BaseCommit <verified-baseline-sha>

# CI: конкретный диапазон; не добавляет локальные изменения:
node scripts/release/plan-components.mjs --mode ci --base <base-sha> --candidate <candidate-sha>

# Будущий selective deploy, только планирование:
node scripts/release/plan-components.mjs --mode deploy --candidate <exact-candidate-sha> --deployed-manifest <last-successful-manifest.json>
```

Deploy planner ничего не публикует, не мигрирует и не перезапускает. Получение доверенного server manifest, membership в release branch, проверка подписей/digests и исполнение cutover принадлежат REL-03…05.

## Ограничения и следующие шаги

- Новый основной/расширенный набор TEST-03…05 ещё должен заменить исторический список focused tests; REL-01 исправляет выбор компонентных границ и добавляет worker regressions, но не объявляет существующий CI полным продуктовым покрытием.
- Полный quick-gate, frontend build и Go suites целиком не запускались в этой задаче: поведение игрового кода не изменено; локально выполнены planner integration, worker build/replay, синтаксис и diff checks. Объединённый release gate остаётся следующим этапом общей реализации.
- На Windows проверен Unicode/space path; newline filename integration автоматически выполняется на Linux, поскольку Windows не разрешает такой путь.
- Declared dependency map пока намеренно широкая для общего runtime; graph validation уменьшает риск пропущенных shared imports, а не доказывает минимальность набора.
- В текущем рабочем дереве много untracked local results. Они классифицируются как non-application inputs, но список всё ещё отражает их пути; упорядочение `.gitignore` входит в отдельную cleanup задачу. Содержимое этих файлов planner не читает.
- Автоматического выбора `origin/main` для local baseline нет: отсутствие baseline даёт полный безопасный набор. Для deployment этот ref вообще не заменяет last-successful manifest.
- Graph metadata не содержит обязательной build source attestation и используется только для расширения набора. Достоверная build/release identity будет добавлена REL-03.

Откат: вернуть прежний gate/CI wiring либо запускать planner с `--full`; production state и БД при этом не меняются.
