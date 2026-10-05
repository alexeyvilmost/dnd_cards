# Восстановление БД, правил и истории

Локальная процедура реализована и проверена на синтетическом integration-стенде.
Она создаёт полный PostgreSQL snapshot, сохраняет исполняемые CJS, восстанавливает
новую БД и продолжает настоящий незавершённый выбор боя через API. Это доказательство
локального recovery пути, не измерение production RTO и не off-host backup сервера.

## Что входит в backup

`scripts/release/native-backup.mjs` принимает только БД с точным loopback DSN,
уникальным run ID и действующим ownership marker. `pg_dump -Fc` сохраняет все
данные/схему, кроме технического `test_run_ownership`: у новой БД остаётся её новый
marker. Snapshot не попадает в Git. Manifest фиксирует время, bytes/SHA-256 всех
файлов, migrations IDs и fingerprint columns/constraints/indexes, artifact/media
references. Credentials в manifest/отчёте отсутствуют; роли/доступы/config требуют
отдельного защищённого recovery канала. Один pg_dump не сохраняет globals кластера.
[PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

Инвентаризация read-only проверяет все JSON/JSONB columns публичной схемы и
известные текстовые reference columns. Неизвестный формат artifact reference
блокирует полноту. В backup копируются все доступные immutable CJS, включая старые,
а не только current artifact. Каждый referenced hash должен иметь файл с теми же
байтами. До/после dump проверяется стабильность schema/reference inventory; затем
восстановленный snapshot проверяется заново. Согласованность самих данных обеспечивает
snapshot pg_dump; файл БД без соответствующих CJS не считается полным recovery.

`media-references.json` сохраняет URL, включая embedded references. Это manifest
ссылок, **не** копия объектов S3/Cloudinary или доказательство их доступности.
Для реального резервирования media нужны inventory/version IDs объектов и
внехостовая копия либо проверенная retention/versioning политика владельца storage.
Автоматические скачивания и настройки storage здесь не выполнялись.

## Повторяемый локальный drill

```text
node scripts/release/restore-drill.mjs --go <local-go> --pg-bin <local-postgres-bin> --output <new-report.json>
```

Запускается новый integration source и другой пустой target. Full gameplay restore
разрешён только для backup, созданного этим harness и связанного с его registry;
произвольный dump или существующая рабочая БД не принимаются. Обычный catalog-only
profile не менялся. `startTestStack({recoverySnapshot})` — отдельный opt-in путь;
он не пересоздаёт restored canonical templates и не переписывает боевые артефакты.

Сценарий создаёт обычную копию лучника, настраивает прочность синтетических противников
через admin API до pinning, начинает бой и получает настоящий `roll_influence`.
После dump/restore сверяются полный run, pending payload, journal/receipt counts,
catalog/envelope hashes и RNG cursor. Повтор старого accepted request возвращает
прежний ответ, не меняя сохранённый бой. Принятие offered influence оплачивает цену
из каноничных данных; повтор не тратит ресурс/боеприпас и не двигает RNG снова.

Целевой worker имеет новый comment-only byte revision B, старый бой остаётся на
артефакте A. Это проверяет retained-artifact routing на тех же операциях, а не
совместимость всех исторических production версий. Новый бой на target отдельно
должен получить B. Полная проверка реальных historical artifacts требует их
разрешённой инвентаризации и exact runtime rehearsal.

После каждого запуска процессы обоих стендов останавливаются. Только их новые
PostgreSQL data directories удаляет проверенный harness; snapshots/reports/CJS
сохраняются в соответствующих `outputs/testing/runs/test_…`, исходные backups и
пользовательские каталоги не затрагиваются. Это новые служебные артефакты проверки;
их очистка — отдельное решение, они не добавляются в репозиторий.

Negative drill принимает путь к такому backup и создаёт отдельные копии:

```text
node scripts/release/restore-negative-drill.mjs --source <owned-recovery-backup> --pg-bin <local-postgres-bin> --output <new-negative-report.json>
```

Отсутствующий CJS, повреждённый snapshot и invalid manifest отвергаются до команд
приложения. Неверный schema fingerprint дополнительно проверен настоящим restore
в новую пустую БД: несовпадение останавливает процесс до запуска API. Unit test
отдельно отвергает изменённые байты CJS и выход пути за backup directory.

## Что доказано и что ещё неизвестно

В финальном успешном запуске snapshot синтетической БД — 1,173,586 bytes, capture
1.94 s, restore + reference/schema checks — 2.27 s, весь сценарий со сборкой,
двумя стендами и API — 56.26 s. Проверены четыре непустые media references,
включая avatar URL, сохранённый обычным API; сами объекты не копируются.
Финальные отчёты лежат в `docs/audits/2026-10-04/execution/REL-06-native-media.json`
и `REL-06-negative.json`.
Эти времена относятся к небольшой локальной fixture, PostgreSQL 17.11/Node
24.19.0/Go 1.25.12 на текущей машине. Production объём, сеть, права и время
возврата публичного сервиса не измерены. Это не обещание восстановления за секунды.

Deployment backup gate не принимает синтетический report за production proof.
Требуются actual backed-up release manifest, свежий snapshot, совпадающий hash
restore report и явно принятый scope `accepted-deployment-recovery`; текущий
native report имеет `owned-synthetic-recovery`. REL-05 cutover остаётся выключен.
Автоматический dump/restore production, удаление backups и отключение обязательного
backup для UI-only релиза не выполнялись.

## Предлагаемая политика для отдельного внешнего этапа

| Категория | Проект политики | Условия удаления |
|---|---|---|
| PostgreSQL snapshots | 7 daily + 4 weekly + 3 monthly, отдельная pre-release копия | Только после подтверждения внехостовой копии и успешного restore drill; сначала dry-run |
| Immutable images/manifests | Active + rollback + все manifests из сохранённых backups | Нет защищённых ссылок, включая mixed releases |
| Rules CJS | Union active/history/pending/backups/release references | Только полная инвентаризация; число последних релизов и возраст недостаточны |
| Frontend hashed assets | Сохранять старые assets до отдельной политики old-tab совместимости | Проверенные references/окно поддержки; сейчас удаления нет |
| Media/config/globals | Отдельный защищённый backup/recovery канал | Независимая политика владельца storage и секретов |

Это предложение, расписание не установлено. Начальные цели для согласования:
RPO ≤ 6 h с periodic snapshots или ≤ 15 min при подтверждённом WAL/PITR;
RTO ≤ 60 min после измерения полного production-sized restore. Реальные значения
зависят от hosting и доступов; WAL archiving/PITR нельзя считать включённым из
наличия pg_dump. [PostgreSQL continuous archiving/PITR](https://www.postgresql.org/docs/17/continuous-archiving.html).

Внешний этап: выбрать независимое от VPS место хранения, проверить доступы и
шифрование/ключ восстановления, измерить production-sized clone, включить
копирование и расписание только отдельным явно запрошенным действием, затем
периодический drill и сигнал только при ошибке/просрочке. Резервная копия на том
же VPS остаётся полезной pre-release точкой, но не защищает от потери хоста.
