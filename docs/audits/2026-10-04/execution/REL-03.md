# REL-03 — локальный manifest и происхождение компонентов

Статус: `implemented_awaiting_integration_environment`, не полный acceptance.
Зависимость TEST-03 ещё проверяется общим runner; Docker daemon недоступен.
Production, Git commit/push, registry и сервер не менялись.

## Реализовано

- `infra/release-manifest.schema.json`: строгая версия 1, отдельные release и
  component SHA, OCI digests, source/toolchain fingerprints, CJS/content hashes,
  протоколы/мировая схема, Node runtime, миграции и validation evidence.
- `scripts/release/validate-manifest.mjs`: offline schema/semantic validator,
  явно недеплоимый legacy adapter; mixed composition, фактические endpoint
  identities + OCI inspection + проверенные reports; historical inventory и
  pending-decision evidence обязательны. Ни один CLI режим не делает mutation.
- `componentInputFingerprint()` учитывает source fingerprint, pinned base images,
  platform и compile args. `compositionFingerprint()` привязывает проверенные
  отчёты к полному составу. Reports хэшируются каноническим JSON; это не подпись CI.
- Backend identity зашита через Go ldflags, frontend/worker — build-time JSON.
  Runtime SOURCE_COMMIT не используется. RELEASE_COMMIT/RELEASE_ID отдельны.
  Локальный запуск без metadata честно сообщает unverified и не проходит preflight.
- Additive `/api/health`, worker `/health`, frontend `/build-info.json`; прежние
  wire aliases сохранены, OBS01 wrapper/metrics сохранены. Worker проверяет CJS и
  фактический Node против build metadata до сохранения/запуска артефакта.
- Compose требует per-component digest. Bake принимает раздельные component
  commit/fingerprint. Context allowlists, dependency planner, source collector
  включают новые build inputs. Старые CJS/history не изменяются.
- Документы `docs/release-manifest.md` и transition gate в старом runbook:
  старый `infra/deploy-release` НЕ совместим с новым Compose до REL-05; пяти
  последних releases недостаточно для mixed-image/pinned-artifact retention.

## Фактически выполненные проверки

1. `node --test scripts/release/validate-manifest.test.mjs scripts/release/measure-local.test.mjs scripts/content/micro-mvp-release-evidence.test.mjs`
   — **44/44 passed, 0 skips**. Отказы при unknown version/protocol/world schema,
   missing component, invalid/mutable digest, ambiguous legacy, env/provenance
   mismatch, stale evidence, несовпадающем runtime, неполной истории и смене
   applied migration; negative CLI не выдаёт env/ready и не меняет manifest.
2. `node --test scripts/release/validate-manifest.test.mjs frontend/worker/server.test.mjs frontend/worker/performance.test.mjs frontend/worker/replay.test.mjs`
   — **17/17 passed, 0 skips**. HTTP worker сохраняет pending envelope/roll/cursor,
   старый CJS доступен после новой версии транспорта; actual replay/held journey
   tests и OBS wrapper прошли. Identity fixture не доказывает все production CJS.
3. `go test . -run '^TestComponentBuildIdentity$' -count=1` (локальный Go 1.25.12)
   — PASS, собирался текущий backend. Проверено, что env не меняет старый baked
   commit, release identity отдельна, malformed/partial identity fail closed.
4. REL-01 planner suite **32/32** прошёл в предыдущем совместном запуске.
5. `node scripts/release/measure-local.mjs --prepare --output outputs/release-measure/rel03-identity`
   — source/COPY/Go embed closure PASS, все пять Compose configs разобраны CLI.
   Новые разрешённые untracked input files включены в чистые snapshots.
   Estimated source bytes: backend 23,635,263; frontend 166,918,803; worker
   8,044,695. Это не Docker transferred context. Снимок принадлежит этому запуску.
6. `docker buildx bake -f infra/docker-bake.hcl -f infra/docker-bake.cache-gha.hcl --print`
   — PASS, без build/push/network mutation.

## Оставшиеся обязательные проверки

- `scripts/release/check-frontend-identity.mjs` выделен в явный POSIX gate:
  нативный POSIX shell отсутствует, WSL не запускается. В mandatory Node tests нет
  anonymous skip. Этот gate ещё не выполнялся в Linux/macOS.
- Реальные immutable Docker builds, health/metadata всех трёх final images,
  digest inspection, mixed image local Compose cutover и manifest rollback не
  проверены. Docker daemon `awaiting_environment`; source/CLI/unit проверки не
  считаются заменой runtime acceptance.
- Нельзя выдать реальный ready manifest до TEST-03, проверок final images,
  полного historical inventory и compatibility отчётов. Preflight принимает
  evidence bundle из доверенного локального/CI runner; автоматическое получение
  bundle/переключение/подпись относится к REL-04/REL-05.
- `docs/release-manifest.md` описывает safe rollback при совместимой БД. Код
  не откатывает БД и не разрешает GC. Старый runner/retention надо заменить до
  явно запрошенного включения на TimeWeb.

Начальный исследовательский запуск содержал 1 явно отмеченный Windows skip
POSIX-проверки. После выделения отдельного platform gate финальный mandatory
набор 44/44 без skips; прежний результат не выдаётся за проверку shell/container.
