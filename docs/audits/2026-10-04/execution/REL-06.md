# REL-06 — доказанный локальный backup/restore

Статус: `verified_owned_native_recovery; production_recovery_unverified`.
Локальный native acceptance выполнен на synthetic integration dataset. Внешние
backup storage/schedule, production snapshot/restore, credentials и удаление
существующих backups не выполнялись. Production-sized restore/RPO/RTO неизвестны.

REL-05 follow-up: подготовлен `scripts/release/capture-host-backup.mjs`, read-only
production-host capture после отдельного enablement. Он фиксирует реальные
backend image/health/DSN и active manifest до/после dump, сохраняет private files
в root/backups/capture-run-attempt. `capture.json` не содержит полного inventory,
schema или restore claims: они появляются только после owned-clone collector.
Четыре локальных contract/fault tests PASS; actual Docker host capture не проверен
из-за недоступного daemon. Private production snapshot или credentials не читались.

Реализованы:

- `backup-manifest.mjs`: строгие owned file paths, SHA-256/bytes, snapshot/CJS/media
  inventory, freshness и matched restore report для deployment gate. Synthetic
  evidence не имеет scope, разрешающего production replacement.
- `artifact-references.mjs`: read-only inventory всех public JSON/JSONB и известных
  text reference columns, schema fingerprint и real applied migration IDs.
- `native-backup.mjs`: pg_dump custom, immutable CJS copy, проверка ссылок; full
  restore только в свежий owned loopback target с отдельным ownership marker.
- `restore-drill.mjs`: настоящий API/worker pending decision + old accepted command
  retry + paid offered influence + duplicate, retained A/current B routing и новый
  бой на B. B — comment-only byte fixture, не новая заявленная механика.
- `restore-negative-drill.mjs`: отдельные copied backups с missing CJS/corrupt
  snapshot/invalid manifest, actual restored-schema mismatch на новой БД.
- Additive `startTestStack({recoverySnapshot,recoveryWorkerArtifact})`; ordinary
  profiles и equipmentIntent/OBS flags сохранены. Полный restore не заменяет
  catalog-only импорт и не пересоздаёт restored templates.
- `docs/backup-restore.md`: категории/ограничения, reproducible commands, план
  off-host copy, RPO/RTO targets для согласования и отдельная reference retention.

## Фактический финальный native drill

Команда:

```text
node scripts/release/restore-drill.mjs --go <LOCALAPPDATA>/dnd-cards-dev/tools/go/bin/go.exe --pg-bin <LOCALAPPDATA>/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin --output docs/audits/2026-10-04/execution/REL-06-native-media.json
```

PASS, exit 0. Source `test_b2aaf3e6d0c7cb927133b980`, restored
`test_409b3b07a9fd389c7f70565b`, оба cleanup `stopped`.

| Измерение | Фактическое значение |
|---|---:|
| Custom snapshot | 1,173,586 bytes |
| Скопированный CJS A | 2,704,571 bytes |
| Media references | 4 непустые ссылки |
| Applied migration IDs | 302 |
| Capture + inventory/files | 1,935 ms |
| Restore + schema/artifact/media checks | 2,269 ms |
| Два стенда, сборки, API, cleanup целиком | 56,262 ms |

Источник схемы — checked-in integration baseline, не прохождение всей исторической
цепочки migration на production clone. Node 24.19.0, PostgreSQL 17.11, Go 1.25.12.
UI использует прежний локальный build; этот drill доказывает API/worker/data recovery,
browser acceptance отдельно TEST-04. Времена нельзя переносить на production объём.

Проверено полное равенство восстановленного run/pending payload и SQL инвариантов.
Старый принятый request возвращает сохранённый ответ без изменений. Принятие real
offered influence по каноничной цене даёт revision 3→4, RNG cursor 5→6, receipts
3→4, journal 2→3; затем точный повтор ничего не меняет. Боеприпас и influence
ресурс списаны ровно один раз. Старый envelope остаётся на A; новый бой получает B.
Seed и полные payload/private данные в Git report не выводятся — только hashes/counts.

Полные безопасные результаты: `REL-06-native-media.json`. Этот запуск дополнительно
создаёт avatar URL через штатный API и требует непустой media inventory; text/avatar
и audio URL входят в scanner. URL — loopback fixture, доступность объекта не заявлена.
Предыдущие успешные `REL-06-native.json` и `REL-06-native-attempt1.json` сохранены
как исторические результаты с более узкими проверками. Исходные backup files находятся только
в ignored owned run directories; они не добавлены в Git.

## Negative и unit checks

`restore-negative-drill.mjs` на backup первого успешного synthetic source —
**4/4 PASS**, включая реальный pg_restore несовместимого schema fixture. Target
`test_12bd69aac393b68772495dd5`, cleanup stopped; отчёт `REL-06-negative.json`.
Ни один negative path не запускает приложение с неподтверждённой схемой/CJS.

```text
node --test scripts/release/backup-manifest.test.mjs scripts/release/deploy-state.test.mjs scripts/release/deployment-handoff.test.mjs scripts/testing/guards.test.mjs
```

**25/25 PASS, 0 skips/TODO**. Unit corrupt CJS отдельно отвергнут при валидном
snapshot; проверены path escape, invalid/incomplete inventory, disabled production
policy, selective state machine, strict owned DSN и cleanup boundaries.
Scoped `git diff --check` — PASS.

## Границы и следующий этап

Native reports имеют `owned-synthetic-recovery`; releaseManifestHash=null, потому
что локальный некоммиченный стенд не является OCI release. Они не открывают REL-05
production gate и не подделывают manifest/source provenance. Для внешнего этапа
потребуются actual release/media/global config inventory и accepted recovery proof.

Media URLs восстановлены, storage objects не копировались и их внешняя доступность
не проверялась. Все настоящие historical CJS под новой версией Node не тестировались;
проверен retained A + new current B fixture. Docker/OCI restore, host file permissions
и off-host durability остаются непроверенными. Dump retention/GC не включены.
Предложенные 7 daily/4 weekly/3 monthly и RPO 6h либо 15min при подтверждённом PITR,
RTO 60min — цели для будущего измерения и согласования, не действующая гарантия.

## Привязка нового host capture к выкатке

Свежий prepared capture дополнительно сохраняет `source-binding.json` в общем
hash-bound file inventory. В нём ID проверенного source backend и hash идентичности
БД без пароля. Проверка учитывает реальный DATABASE_URL контейнера, а не текущий
app.env. Deployment DB probes и effective candidate Compose обязаны сохранить эту
идентичность; изменённый app.env или worker env override отказываются до cutover.
Приватный resolved Compose snapshot с mode 0600 содержит effective environment,
поэтому не предназначен для Git/CI artifact publication. Пароли не добавлены
в capture, active state или operation journal.

Общий release regression **154/154 PASS**, независимый adapter/state review
**24/24 PASS**. Настоящий config-only Compose roundtrip с literal `$` также PASS;
пути evidence и точные ограничения приведены в соседнем [REL-05.md](REL-05.md).
Это подтверждение локальных guard/serialization contracts; actual production
dump/OCI restore/remote media availability по-прежнему не проверены.
