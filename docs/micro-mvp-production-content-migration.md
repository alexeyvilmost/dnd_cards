# Миграция mechanics micro-MVP в production

**Статус:** исполняемый runbook; запись в production разрешена только в окно
обслуживания после успешного staging-прогона.

**Состояние текущего release-candidate:** production ещё не изменён — ни
content patch, ни migrations этого кандидата, ни certification support туда не
применялись. Текущие числа и pins ниже описывают локально проверяемый source
candidate, а не production evidence. Фактические dump metadata, deployment SHA,
production plan/evidence и postimage заполняются только на соответствующем шаге
runbook.

## Что является источником правил

Версионированный набор изменений хранится в
`frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json`. После миграции
авторитетными для сборки персонажа являются production-записи и их
`mechanics`. Overlay остаётся только совместимым адаптером старого pinned
snapshot; production compiler запускается в `verify-only` и не имеет права
добавлять или исправлять механику по ID сущности.

Каждая update-декларация разделяет два CAS-контракта. `expectedBefore*Hash`
навсегда относится к immutable source snapshot и позволяет детерминированно
собрать legacy overlay. Опциональный `productionExpectedBefore*Hash` относится
к вручную проверенному текущему production preimage и используется только
migrator; при его отсутствии production CAS совпадает с source CAS. Live drift
нельзя «исправлять» заменой source hash. Структура patch проверяется отдельной
JSON Schema до построения плана.

Инвариант проекта: Action и Spell — Effect с activation/cost; Condition и
Weapon Mastery — Effect. Код движка реализует только переиспользуемые
schema-validated primitives, а выбор primitive и его параметры объявляются в
`mechanics`. Полная формулировка зафиксирована в
`docs/engine/effects-first-authoring-invariants.md`.

Три пакта Колдуна первого уровня следуют этому контракту явно. Их записи
объявляют `pact_blade_bond`, `pact_chain_familiar` или `pact_tome_book`, stable
state capability, а для Chain/Tome также spell/choice/book/resource references.
Компилятор связывает состояние и actions по этим полям и fail-closed отклоняет
неполную либо противоречивую декларацию; UUID/card number используются для
выбора конкретной release entity и provenance, но не выбирают тип поведения.

Текущий reviewed patch `1.5.0` объявляет 108 целевых сущностей относительно
pinned baseline:

| Коллекция API | Операций |
|---|---:|
| cards (12 достижимых Weapon Card с полным `mechanics.weapon_profile`) | 12 |
| effects (34 mechanics + 15 conditions + 3 provider create) | 52 |
| actions | 9 |
| spells | 26 |
| races | 2 |
| classes (включая PHB 2024 starting equipment и базовую тренировку Друида) | 7 |

Release identity текущего source candidate — overlay `1.9.0`:

| Pin | SHA-256 |
|---|---|
| content patch | `sha256:7a07f8b1ed3483370093c67277363d0b1a95852126db1ab124eabc813b6c5bc7` |
| overlay | `sha256:980678c4ab6c2d696b150142ce3ab2e3fa52bbc49cee5c9844b2535542aed108` |
| compiled content | `sha256:6b04b93ad93476c2e57224f902d1a0739e1ff3fa4994e9d36f6e77d7b927ff48` |
| compiled release | `sha256:8568dc40ae99dd4ea3d981799941e510445a682a107aece7c62a752593a8689c` |

Предыдущие patch `1.2.0`–`1.4.0`, их pins и планы superseded и не являются
текущими кандидатами, rollback bundle либо основанием для production apply.
Их старый restored-dump drill ниже сохранён только как историческая проверка
транзакционного протокола.

Sheet primitive catalog привязан к этой exact release identity и строится из
скомпилированного каталога, а не из UI-списка. В closure входят 12 Weapon Card,
все 8 Weapon Mastery Effect, транзитивные зависимости `grant_effect` и только
явно поддержанные no-pending primitives. Отсутствующая, лишняя или изменённая
зависимость, несовпавший release/content hash либо primitive с незавершённым
pending lifecycle закрывают sheet-path до списания цены.

На живом каталоге число операций может быть меньше, если запись уже полностью
материализована. Любое третье состояние (не reviewed preimage и не desired
postimage) является drift и останавливает план без записи.

Свежий production snapshot от 2026-08-06 подтвердил именно этот допустимый
случай: `EFF-divine-order`, `RACE-0002` и `RACE-0008` уже byte-exact в desired
projection. Поэтому текущий production preimage даёт 105 фактических writes из
108 деклараций: cards 12, effects 51, actions 9, spells 26, races 0, classes 7.
Из них 100 update и 5 create: три provider Effect и отсутствующие в источнике
`COND-exhaustion`/`COND-petrified`. Это не ослабление denominator: все 108
деклараций проверяются, а уже точные три строки становятся no-op.

### Граница catalog attestation

Live gate не требует байтового равенства всей production БД историческому
`prod-snapshot`: в общей БД уже могут находиться сущности mini-/part-MVP, а их
добавление не должно отменять приёмку micro-MVP. Блокирующий контракт состоит из
двух последовательных проверок:

1. production-каталог компилируется только в `verify-only`; отсутствие любой
   строки/связи/mechanics из версионированного patch останавливает gate, и
   compatibility overlay не может незаметно исправить live-данные;
2. семантическая проекция всех 448 скомпилированных корней (включая выбранные
   сущности, эффекты, действия, заклинания, состояния персонажей, решения и
   world objects) должна иметь тот же SHA-256, что reviewed materialized
   baseline. Изменение исполняемых полей используемой сущности или попадание
   новой строки в открытый choice-domain меняет проекцию и блокирует release;
   неиспользуемая сущность вне denominator допустима.

Проекция берётся из самого compiler (`microMvpL1RootSemanticProjection`), а не
поддерживается второй копией полей в release gate. UUID строк, созданных через
production POST, до хеширования заменяются однозначными
`collection:card_number`/`resource_id` identities: назначенный БД surrogate ID
не является правилом. Неоднозначная stable identity остаётся привязанной к ID и
fail-closed. Порядок внутри механики/действия сохраняется; только явно
set-like верхнеуровневые списки корня пересортировываются после замены UUID.
Нативные `contentHash`/`releaseHash` компилятора (до этой замены) сохраняются в
attestation как `compilerRaw` для расследования, но release/evidence profile
ссылается на reviewed semantic release после успешного exact сравнения.

Полный raw fingerprint всех коллекций и normalized semantic diff при этом
сохраняются в результате live gate как диагностика, но не сравниваются с
устаревающим полным snapshot как условие успеха. Это не ослабляет защиту от
гонки: schema-v3 release evidence фиксирует frontend origin и полный **текущий
live catalog** после 16 gate, а certification CLI повторно сравнивает его до
login/первой записи. `deployment_health` выполняется последним и требует один
exact 40-hex SHA одновременно от backend `/api/health` и frontend
`/build-info.json`; mismatch, отсутствующий или malformed ответ любого сервиса
закрывает release.
Любое изменение БД между evidence и apply по-прежнему останавливает операцию.
Ночной `export-prod` остаётся отдельным глобальным отчётом о drift всего контента.

Актуальная репетиция 2026-08-06 текущего patch на двух независимых клонах
свежего production dump выполнила 105-write apply, отдельный no-op plan 0,
105-write exact rollback и повторный plan 105 на каждом клоне. Ни один локальный
drill-bundle всё равно нельзя применять к production: после deployment
API-контракта нужны новый post-A dump, новый read-only production plan и новый
immutable bundle. Любое изменение patch, API response contract или
production-записей делает старый bundle непригодным.

## Два разных средства восстановления

1. **Полный custom-format `pg_dump`** — disaster recovery всей БД. Он
   обязателен для `--apply`; CLI проверяет `PGDMP` signature, а метаданные
   должны подтверждать контрольную сумму, размер архива и успешный тестовый
   `pg_restore --exit-on-error`.
2. **API preimage bundle schema v4** — точечный rollback только затронутых
   строк. Bundle получает UUID, входящий в immutable `planHash`. Он
   содержит полные ответы API до изменения, их SHA-256, declared payload,
   ожидаемую проекцию, fingerprint всего каталога и после применения — полный
   postimage. `createdAt`, fingerprint, dependency order и фиксированный
   `writeProtocol` входят в immutable plan. Все create/provider-операции идут
   перед consumer updates; rollback использует точный обратный порядок. Это не
   замена SQL-дампа.

Создание effect выполняется не обычным `POST /effects`, а защищённой атомарной
операцией: Effect и server-issued receipt записываются в одной транзакции.
Receipt хранит bundle/plan/operation/entity/card, полный postimage и его hash.
Миграция БД `093_add_content_migration_receipts` добавляет ledger; её rollback
намеренно не удаляет audit trail. Общего hard-delete API нет.

Свежий pre-A production dump текущего кандидата:

- metadata: `backups/prod-before-micro-mvp-20260806T055629Z.metadata.json`;
- archive: `backups/prod-before-micro-mvp-20260806T055629Z.dump`;
- archive SHA-256:
  `c4550c89d4404482756ed06ae393a5f18c7825e11343644f0bedccf3a7105768`;
- archive size: 9 649 420 bytes; TOC: 608 entries; mode обоих файлов `0600`;
- PostgreSQL 17.10 restore proof: `2026-08-06T06:01:36Z`; контрольные
  счётчики: actions 46, effects 506, spells 715, cards 938,
  characters_v3 10, users 15, schema_migrations 90.

`verifyBackupMetadata` принимает этот archive/metadata. Он является disaster
recovery preimage для phase-1 schema deployment и источником актуального
двухклонового drill. После deployment commit A перед первым production content
apply всё равно снимается новый post-A dump с отдельным restore proof.

Исторический production dump superseded кандидата сохранён отдельно:

- metadata:
  `backups/prod-pre-final-source-20260805T210629Z.metadata.json`;
- archive SHA-256:
  `3f1eef557561118c94771a1ef484676370c7b6dd37799e34d534d307e8891cf1`;
- archive size: 9 649 420 bytes; TOC: 608 entries;
- восстановление проверено на одноразовом PostgreSQL 17 с
  `pg_restore --exit-on-error`.

Старый архив не соответствует текущему кандидату и не разрешает запись в
production. Startup backend автоматически применяет миграции БД, поэтому
первый deployment уже является production mutation. После успешного deployment
API-контракта снимается новый свежий архив, строятся read-only plan и immutable
production bundle. Если post-A архив вышел за допустимое временное окно до
первого `--apply`, окно закрывается и процедура начинается заново с нового dump.

Новый metadata-файл обязан указывать точный источник (значения также
версионированы в `scripts/content/production-content-source.v1.json`):

```json
{
  "created_at_utc": "<fresh UTC RFC3339 captured at the actual dump step>",
  "source": {
    "provider": "Railway",
    "project_id": "3ec4e61c-9a4d-4b7b-99b8-ce2a560a8b55",
    "environment_id": "ef702856-4300-4476-852a-1d4cc23532d7",
    "service_id": "b008bd10-e7ad-41f6-97ad-1a8060a57110",
    "database": "railway"
  },
  "archive": {
    "file": "<fresh explicit .dump filename>",
    "format": "custom",
    "size_bytes": "<actual positive integer>",
    "sha256": "<actual 64-hex SHA-256>",
    "toc_entries": "<actual positive integer>"
  },
  "restore_verification": {
    "pg_restore_exit_on_error": true,
    "verified_at_utc": "<actual UTC RFC3339 after restore>",
    "postgres": { "major": 17, "version": "<actual full PostgreSQL version>" },
    "row_counts_captured_at_utc": "<actual UTC RFC3339 after restore>",
    "row_counts": {
      "effects": "<actual integer>",
      "schema_migrations": "<actual integer>"
    }
  }
}
```

Для каждого нового архива placeholder-строки сначала заменяются фактическими
значениями, а числовые поля записываются как JSON numbers. Незавершённый
metadata-файл не создаётся и не считается evidence. Metadata и archive должны быть
обычными файлами, не symlink, без любых group/world permission bits. CLI
проверяет actual mode обоих файлов, положительный TOC, PostgreSQL major/version
восстановленной БД и непустые control row counts, снятые только после успешного
`pg_restore --exit-on-error`.

Для первого `--apply` dump должен быть создан не более двух часов назад,
успешный restore proof — не раньше dump и не позднее чем через 30 минут после
него. Допускается до пяти минут clock skew. Restore proof обязан предшествовать
`createdAt` нового reviewed plan. Resume/rollback могут использовать ставший
старше исходный архив, но только при точном совпадении уже закреплённого SHA-256.

CLI технически не позволит начать `--apply` без такого проверяемого архива.
Он также требует rollback-complete версии Effect и Action API: response обязан
возвращать provenance и все mutable relationships. Это нужно развернуть до
создания финального production bundle; старый API будет отвергнут до первой
записи. До deployment должны быть настроены `JWT_SECRET` длиной не менее 32
символов, `CONTENT_ADMIN_USER_IDS` и `CONTENT_CERTIFICATION_KEY`.
`CONTENT_ADMIN_USER_IDS` — server-side comma-separated allowlist UUID
пользователей (например, `uuid-1,uuid-2`), которым разрешены изменения
глобальных каталогов и изображений. Пустая или невалидная конфигурация закрывает
эти routes с `503`, валидный JWT пользователя вне allowlist получает `403`.
Любая update/create/rollback операция миграции дополнительно требует
certification key. Update не использует обычный catalog PUT: отдельный endpoint
под `FOR UPDATE` сравнивает полный expected API response и принимает только
явно разрешённые content fields.
Все эти routes используют строгий HS256 JWT с issuer `dnd-cards-backend`, без
public-user fallback. Character и encounter routes этим allowlist не меняются,
но сами `/api/characters-v3/**` и `/api/encounters/**` также требуют строгий
JWT. Исторические CharacterV3 владельца `public` остаются видимыми
авторизованным пользователям только для чтения и не переназначаются этой
миграцией.

UUID текущего администратора можно получить через login, не печатая JWT:

```bash
read -r "CONTENT_ADMIN_USERNAME?Username: "
read -r -s "CONTENT_ADMIN_PASSWORD?Password: "
printf '\n'
jq -n --arg username "$CONTENT_ADMIN_USERNAME" --arg password "$CONTENT_ADMIN_PASSWORD" \
  '{username: $username, password: $password}' \
  | curl --silent --show-error --fail-with-body \
      -H 'Content-Type: application/json' --data-binary @- \
      "$API_URL/api/auth/login" \
  | jq -er '.user.id'
unset CONTENT_ADMIN_PASSWORD
```

Ответ login проходит по pipe напрямую в `jq`, поэтому token не попадает в
терминал или shell history. Полученный UUID нужно задать в
`CONTENT_ADMIN_USER_IDS`; сам JWT не записывается в bundle. Можно передать
готовый `API_TOKEN` или задать `CONTENT_ADMIN_USERNAME` и
`CONTENT_ADMIN_PASSWORD`: мигратор вызовет общий `api.mjs login()` только после
локальной проверки integrity/backup. Токен apply/rollback и certification
обязан принадлежать одному из UUID этого allowlist.

### Обязательная ротация importer credentials

Старые importer credentials считаются раскрытыми: их значения ранее были
зашиты в tracked scripts. Такой пароль нельзя использовать повторно, а UUID
этого пользователя нельзя добавлять или сохранять в `CONTENT_ADMIN_USER_IDS`,
пока пароль не заменён. Безопасный порядок перед первым deployment:

1. получить свежий production dump и успешно восстановить его в одноразовую БД;
2. записать новый уникальный пароль в password manager/macOS Keychain через
   скрытый prompt, не передавая пароль аргументом процесса;
3. заменить ровно одну строку `users` по заранее проверенным UUID и username в
   транзакции; SQL получает только bcrypt hash, не plaintext;
4. убедиться, что старый пароль даёт `401`, новый — `200`, при этом response
   body с JWT всегда отбрасывается;
5. только после этого сохранить UUID в allowlist. Одновременно задать новый
   независимый `JWT_SECRET` (не менее 32 случайных символов) и новый
   `CONTENT_CERTIFICATION_KEY`, deploy-нуть backend и получить новый JWT. Смена
   `JWT_SECRET` инвалидирует все токены, выданные до ротации.

На macOS новый пароль вводится в Keychain через скрытый prompt (`-w` должен
быть последним аргументом и не иметь значения):

```bash
IMPORTER_USERNAME='importer_user'
IMPORTER_UUID='<UUID, подтверждённый на свежем dump>'
CONTENT_ADMIN_KEYCHAIN_SERVICE='dnd-cards-production-content-admin'

security add-generic-password \
  -a "$IMPORTER_USERNAME" \
  -s "$CONTENT_ADMIN_KEYCHAIN_SERVICE" \
  -U -T "" -w
```

Вставить в prompt новый случайный пароль из password manager. Не использовать
значение из git/history. Затем получить пароль только в shell variable, передать
его `htpasswd` через stdin и сразу удалить plaintext variable:

```bash
IMPORTER_NEW_PASSWORD="$(security find-generic-password \
  -a "$IMPORTER_USERNAME" -s "$CONTENT_ADMIN_KEYCHAIN_SERVICE" -w)"
IMPORTER_NEW_HASH="$(
  printf '%s\n' "$IMPORTER_NEW_PASSWORD" \
    | /usr/sbin/htpasswd -niBC 12 '' \
    | sed -E 's/^://; s/[[:space:]]+$//'
)"
unset IMPORTER_NEW_PASSWORD

[[ "$IMPORTER_NEW_HASH" == '$2y$12$'* || "$IMPORTER_NEW_HASH" == '$2b$12$'* ]]
```

В уже аутентифицированном `psql` production-сеансе выполнить проверенный
`scripts/content/rotate-content-admin-password.sql`. Конкретный
Railway/PostgreSQL connection string не печатать и не сохранять в history. В
`psql` передаётся только salted bcrypt hash, не пароль:

```bash
psql '<approved connection; obtain without shell history>' -X \
  -v ON_ERROR_STOP=1 \
  -v importer_uuid="$IMPORTER_UUID" \
  -v importer_username="$IMPORTER_USERNAME" \
  -v new_hash="$IMPORTER_NEW_HASH" \
  -f scripts/content/rotate-content-admin-password.sql
```

Скрипт валидирует UUID и bcrypt cost 12, обновляет ровно совпавшего активного
пользователя и делает `ROLLBACK`/exit 3, если строка не найдена. Если approved
connection содержит пароль, вместо literal использовать PGSERVICE/Keychain или
интерактивный Railway connection flow; секретный URL не должен быть аргументом
process или строкой history.

После успешного `COMMIT` выполнить black-box проверку. Ни пароль, ни JWT не
попадают в stdout; выводятся только HTTP-коды:

```bash
login_status() {
  local candidate_password="$1"
  jq -n \
    --arg username "$IMPORTER_USERNAME" \
    --arg password "$candidate_password" \
    '{username: $username, password: $password}' \
    | curl --silent --show-error \
        --output /dev/null --write-out '%{http_code}' \
        -H 'Content-Type: application/json' --data-binary @- \
        "$API_URL/api/auth/login"
}

read -r -s "IMPORTER_OLD_PASSWORD?Previously exposed password (verification only): "
printf '\n'
OLD_STATUS="$(login_status "$IMPORTER_OLD_PASSWORD")"
unset IMPORTER_OLD_PASSWORD

IMPORTER_NEW_PASSWORD="$(security find-generic-password \
  -a "$IMPORTER_USERNAME" -s "$CONTENT_ADMIN_KEYCHAIN_SERVICE" -w)"
NEW_STATUS="$(login_status "$IMPORTER_NEW_PASSWORD")"
unset IMPORTER_NEW_PASSWORD

printf 'old=%s new=%s\n' "$OLD_STATUS" "$NEW_STATUS"
[[ "$OLD_STATUS" == '401' && "$NEW_STATUS" == '200' ]]
unset IMPORTER_NEW_HASH OLD_STATUS NEW_STATUS
```

При любом другом сочетании кодов allowlist не менять и deployment не
продолжать. Если importer больше не нужен, безопаснее удалить его UUID из
allowlist и использовать отдельного content-admin пользователя; ротация всё
равно обязательна, пока раскрытая учётная запись остаётся активной.

## Что именно гарантирует точечный rollback

- Для update полный `expected_current` сверяется сервером под row lock, а
  изменяются только allowlisted поля из reviewed bundle. Тот же exact-current
  CAS используется при восстановлении content preimage; ordinary PUT запрещён.
  PostgreSQL trigger обязан инвалидировать `support` до `null`; после этого
  отдельный защищённый endpoint под row lock и exact-current CAS восстанавливает
  исходный raw JSONB `support` — включая неизвестные текущей схеме legacy-поля.
- Итоговый API response сравнивается с preimage по всем полям. Единственное
  документированное исключение — server-managed `updated_at`, который меняет
  PostgreSQL trigger даже при support-only UPDATE. `support: null` также
  проверяется как точный `null`.
- Для созданного Effect защищённый endpoint принимает только tuple и hash из
  server-issued receipt. В одной транзакции он блокирует receipt и строку,
  сверяет postimage, при необходимости делает обычный soft-delete, физически
  удаляет уже tombstoned строку и переводит receipt в `rolled_back`. Поэтому
  после rollback не остаётся ни live-строки, ни tombstone, а audit receipt
  остаётся.
- Состояния `writing`, `applied-unverified`, `rollback-content-writing`,
  `rollback-content-restored`, `rollback-support-writing` и
  `rollback-hard-delete-writing` сохраняются атомарной заменой bundle-файла.
  Потерянный HTTP response можно согласовать и продолжить; неизвестный исход
  записи или чужой drift останавливает rollback fail-closed.
- Apply-порядок стабильно размещает все создаваемые providers перед updates,
  которые начинают на них ссылаться. Точный reverse rollback сначала
  восстанавливает consumers и только затем удаляет providers; тест перебирает
  каждый возможный interruption prefix обоих направлений.

## Обязательная последовательность

### Актуальная двухклоновая репетиция patch 1.5.0

2026-08-06 свежий Railway production dump был независимо восстановлен через
`pg_restore --exit-on-error` в два disposable PostgreSQL 17.10 clone. После
startup migrations оба имели 96 `schema_migrations`. На каждом клоне:

1. read-only plan проверил все 108 patch declarations и выбрал 105 writes;
2. breakdown фактических writes: effects 51, actions 9, spells 26, cards 12,
   classes 7; `EFF-divine-order`, `RACE-0002` и `RACE-0008` были exact no-op;
3. apply завершил 105/105: 100 update и 5 create; повторный независимый plan
   дал 0;
4. materialized live matrix прошёл: 448/448 root builds и 6/6 live
   certification/matrix tests;
5. первый rollback drill обнаружил реальный transport defect: receipt создавался
   из GORM `CreatedAt` с наносекундами, а PostgreSQL API возвращал сохранённые
   микросекунды. Ledger корректно отказал hard-delete с `409`, не удалив строку;
6. backend исправлен: create transaction повторно читает persisted Effect и
   только из него формирует response/receipt. PostgreSQL regression принудительно
   использует непредставимый nanosecond timestamp; receipt/current hashes после
   исправления совпадают для всех пяти create;
7. оба клона были заново восстановлены из того же SHA-pinned dump. Apply 105,
   no-op 0 и reverse rollback 105/105 завершились на каждом. Effects вернулись
   511 → 506 (активные 483 → 478), created rows отсутствуют физически,
   active receipts = 0, пять receipts на клон сохранены как `rolled_back`;
8. повторный read-only plan после rollback снова дал 105 на обоих клонах.

Таким образом текущий drill доказывает и fail-closed обнаружение drift, и
успешный exact rollback исправленного API. Bundle каждого клона привязан к
локальному API base/UUID и не является production bundle.

### Историческая superseded disposable restored-dump репетиция

2026-08-06 был выполнен локальный schema-v4 drill предыдущего patch без записи
в production API/БД. Он сохранён только как evidence crash-safe
apply/rollback-протокола; он superseded актуальной репетицией выше. Тогда
использовались два независимых клона одного dump:

1. custom dump с SHA-256
   `3f1eef557561118c94771a1ef484676370c7b6dd37799e34d534d307e8891cf1`
   восстановлен через `pg_restore --exit-on-error` в PostgreSQL 17; исходные
   счётчики: actions 46, effects 506, spells 715, characters_v3 10, users 15;
2. backend последовательно применил migrations 090, 091, 092 и 093, после чего
   в `schema_migrations` было 94 записи;
3. на обоих клонах schema-v4 plan содержал ровно 90 операций: 85 update и
   5 create; breakdown: effects 50, actions 7, spells 25, cards 1, classes 7;
   у 20 update исходный `support` был ненулевым;
4. первый пробный apply корректно остановился одинаково на обоих клонах и
   обнаружил, что JSON decoder мог deep-merge непустую старую mechanics вместо
   exact replacement. Endpoint исправлен: reviewed fields декодируются в
   отдельную patch model; PostgreSQL regression фиксирует отсутствие legacy
   ключей. После этого оба клона заново восстановлены из исходного dump;
5. финальный apply завершил 90/90 на каждом клоне, raw `effects` вырос с 506 до
   511 (активных 478 → 483), ledger содержал 5 active receipts, независимый
   повторный plan дал 0 на обоих;
6. materialized live matrix и certification audit прошли на каждом клоне:
   2 файла, 6 тестов, включая все 448 корневых сборок;
7. reverse dependency-safe rollback завершил 90/90 на каждом клоне; raw
   `effects` вернулся к 506 (478 активных), созданные строки отсутствуют
   физически и как tombstone, active receipts = 0, пять audit receipts имеют
   статус `rolled_back`; повторный plan снова дал ровно 90;
8. Go unit/race/vet, Node crash-resume/interruption-prefix suite и отдельная
   PostgreSQL exact-replacement integration regression прошли после исправления.

Исторический drill доказывает поведение schema-v4 content apply/rollback только
для superseded preimage/plan. Он не является evidence текущего source candidate
и не заменяет production release evidence или schema-v3 certification support:
они создаются только после deployment и materialization на точном deployed
commit.

Его bundles привязаны к старому patch и локальному API base и непригодны для
production. Перед phase-1 deployment необходимы свежий production dump с
restore proof и окно обслуживания. Только после успешного deployment
rollback-complete API-контракта создаются новый read-only plan и production
bundle; до их review запись контента запрещена.

### 1. Локальная проверка

Из корня репозитория:

```bash
cd frontend
npm run test:micro:manifest
npx vitest run src/engine/validateMechanics.test.ts \
  src/canon/declarativeMechanicsPatch.test.ts \
  src/canon/microMvpL1Overlay.test.ts
npm run rules-lab:check
npm run build
```

`migrate-micro-mvp-l1-mechanics.test.mjs` доказывает fail-closed CAS,
сохранение полных preimages, schema/interpreter allowlist и backup guard.

### 2. Staging read-only план

Для staging используется отдельный staging dump/restore proof; production
архив нельзя считать его заменой. `--bundle` не должен существовать:

```bash
API_URL=https://staging.example \
node scripts/content/migrate-micro-mvp-l1-mechanics.mjs \
  --bundle backups/micro-mvp-staging-preimage.json
```

Проверить вручную в bundle:

- точный `apiBase`, patch ID/version/hash и число операций;
- `catalogFingerprint` со всеми declared коллекциями; любое изменение даже
  незатронутой строки до первого apply остановит запись;
- `planHash`: CLI повторно проверяет его перед apply/rollback и отвергает
  отредактированный после planning bundle;
- полный `before` и `beforeHash` каждой update-операции;
- отсутствие неожиданных ID/card-number и полей;
- expected payload восьми mastery и пятнадцати conditions;
- create-операции только для заранее объявленных отсутствующих строк.

### 3. Staging apply и rollback drill

```bash
API_TOKEN=... CONTENT_CERTIFICATION_KEY=... API_URL=https://staging.example \
node scripts/content/migrate-micro-mvp-l1-mechanics.mjs --apply \
  --bundle backups/micro-mvp-staging-preimage.json \
  --backup-metadata backups/staging-before-micro-mvp.metadata.json \
  --confirm-api https://staging.example
```

После проверки выполнить rollback тем же bundle и тем же dump:

```bash
API_TOKEN=... CONTENT_CERTIFICATION_KEY=... API_URL=https://staging.example \
node scripts/content/migrate-micro-mvp-l1-mechanics.mjs --rollback \
  --bundle backups/micro-mvp-staging-preimage.json \
  --backup-metadata backups/staging-before-micro-mvp.metadata.json \
  --confirm-api https://staging.example
```

Rollback сначала сверяет полный SHA-256 каждого текущего postimage. При
последующем чужом изменении строки он откажется её перезаписывать.

### 4. Production backup и phase-1 commit A

После всех локальных gate и staging drill, но **до первого push/deployment**:

1. остановить изменение production-контента на окно обслуживания;
2. снять свежий Railway custom-format dump с точной identity из
   `production-content-source.v1.json`;
3. восстановить архив в одноразовый PostgreSQL 17 с
   `pg_restore --exit-on-error`, зафиксировать SHA-256, размер, TOC, права
   `0600`, время и контрольные row counts в metadata;
4. зафиксировать полный 40-hex SHA **commit A** с rollback-complete API,
   migrations и инструментом materialization;
5. только затем доставить commit A через GitHub-trigger в ветку, которую
   действительно отслеживают оба Railway-сервиса (на момент написания —
   `main`), и дождаться terminal `SUCCESS` exact commit для backend и frontend;
6. не использовать `railway up` для attestable release: Railway предоставляет
   `RAILWAY_GIT_COMMIT_SHA` только GitHub-triggered deployment, а без него
   backend health возвращает `source_commit: "unavailable"`, а frontend
   `/build-info.json` — `source_commit: null`;
7. подтвердить по Railway deployment metadata SHA commit A обоих сервисов,
   затем exact SHA в backend `/api/health` и frontend `/build-info.json`,
   API-контракт и наличие всех ожидаемых `schema_migrations` до
   построения production plan.

Такой порядок обязателен, потому что backend запускает миграции при старте.
Свежий архив защищает не только content apply, но и первую schema mutation.
Если к моменту `--apply` архив старше двух часов либо restore proof не укладывается
в 30 минут после создания архива, deployment/apply окно закрывается: нужен новый
dump и новый restore proof; старый bundle для первого apply не используется.
Предшествующий commit A архив при этом сохраняется как disaster-recovery
preimage первой schema mutation, а свежий post-A архив становится guard для
content apply.

### 5. Production read-only plan и apply

Продолжать держать окно изменения контента закрытым. Каждая выбранная строка
защищена server-side exact-current CAS под row lock, но вся серия HTTP-операций
не является одной транзакцией. Межоперационное окно остаётся; поэтому окно
обслуживания и durable resume/rollback bundle обязательны.

После успешного phase-1 deployment создать новый production bundle read-only и
review-нуть его отдельно. Restore proof из шага 4 должен предшествовать
`createdAt` bundle:

```bash
API_URL=https://backend-production-41c3.up.railway.app \
node scripts/content/migrate-micro-mvp-l1-mechanics.mjs \
  --bundle backups/micro-mvp-production-preimage.json
```

Проверить те же identity, patch/release hashes, fingerprint, preimages,
dependency order и точный набор операций, что перечислены в шаге 2. Только
после review выполнить:

```bash
API_TOKEN=... CONTENT_CERTIFICATION_KEY=... \
API_URL=https://backend-production-41c3.up.railway.app \
node scripts/content/migrate-micro-mvp-l1-mechanics.mjs --apply \
  --bundle backups/micro-mvp-production-preimage.json \
  --backup-metadata backups/prod-before-micro-mvp-YYYYMMDDTHHMMSSZ.metadata.json \
  --confirm-api https://backend-production-41c3.up.railway.app
```

Не использовать historical metadata `20260805T135818Z` для текущего apply:
непосредственно перед окном обслуживания нужен новый production dump и новый
успешный restore proof, связанный с финальным patch.

CLI повторно загружает весь каталог, сравнивает полный fingerprint, проверяет
полный preimage каждой строки до первой записи, затем после каждой записи
заново читает строку и сохраняет её
полный postimage. При ошибке bundle получает статус `partial`; нельзя удалять
или редактировать его. Повтор той же команды `--apply` с тем же bundle и тем же
проверенным backup безопасно согласует сохранённые состояния `planned`,
`writing`, `not-applied`, `write-outcome-unknown`, `applied-unverified` и
`applied`: уже подтверждённые операции не записываются повторно, неизвестный
результат сверяется с исходным/ожидаемым postimage, а любое третье состояние
останавливает продолжение fail-closed. Если состояние нельзя согласовать,
перейти к точечному rollback (когда postimage известен) либо к SQL restore.

Preflight до первой mutation также проверяет rollbackability всех ненулевых
`before.support`: допускается произвольный безопасный JSON object, а не только
поля текущей certification schema. Циклы, non-finite numbers, non-plain objects
и prototype-pollution keys отвергаются. При любой непустой migration plan
`CONTENT_CERTIFICATION_KEY` обязателен уже для `--apply`, а не впервые во время
аварийного rollback.

### 5.1. Materialized source и финальный commit B

Успешный content apply ещё не является кандидатом на приёмку: commit A содержит
старый pinned production snapshot и, возможно, временные source-correction
ветви. Не снимая окно обслуживания:

1. повторить read-only plan и потребовать ровно `0 operation(s)`;
2. выполнить `export-prod` из production в
   `officials/canon/prod-snapshot/**` и проверить semantic diff;
3. убрать runtime-ветви source correction/overlay, которые мутационно
   исправляли теперь materialized данные. Immutable migration patch, receipts
   и rollback-аудит сохранить; production compiler оставить строго
   `verify-only`;
4. пересчитать source/content/overlay/compiled/release identities, обновить все
   связанные pins и сгенерированные проверочные artifacts, затем повторить
   локальные mandatory gates;
5. зафиксировать это единым **commit B**. Все файлы, входящие в source
   fingerprint, должны быть committed и byte-exact; dirty/untracked release
   input запрещён;
6. доставить exact commit B в backend и frontend только через GitHub-trigger,
   дождаться terminal `SUCCESS` обоих deployment, сверить Railway SHA и
   exact SHA в `/api/health.source_commit` и `/build-info.json.source_commit`,
   затем ещё раз потребовать no-op production plan.

Именно commit B, а не A, является единственным кандидатом для release evidence
и certification. Полный безопасный порядок:

`backup → commit A deploy → content apply → export/remove corrections/final pins
→ commit B deploy → evidence B → certification B`.

После начала evidence нельзя менять source-файлы, создавать новый commit или
перезапускать deployment. Любое такое изменение создаёт нового кандидата B2 и
требует заново пройти deployment attestation, evidence и certification.

### 6. Приёмка после записи

Только после фактического выполнения no-op plan, export и deployment commit B
из 5.1 дальнейшая приёмка относится к exact commit B. Для текущего кандидата
эти production-шаги ещё не выполнялись:

1. Сформировать единый release evidence artifact schema v3. Генератор запускает
   все 16 обязательных product/rules gate: backend `go test` с PostgreSQL
   integration и `go vet`, frontend `npm test` и `test:mvp`, manifest, offline
   matrix, 100% structural rules-core и primitive coverage, semantic coverage,
   live matrix (`MVP_CONTENT=1` + exact `VITE_API_URL`), полный 448-root
   `sheet-combat-certification:check`, Rules Lab fixture check, build, lint и
   browser Playwright. У всех тестовых gate должно быть ненулевое
   число тестов, `0 failed` и `0 skipped`. Общий `npm test` обязан иметь `0 todo`;
   `test:mvp` запускается с live-контентом и допускает только три закреплённых по
   полному имени post-micro-MVP `todo` (`set_die`, runtime `grant_action` и
   фактическое перемещение). Любой иной skip/todo останавливает evidence.

   Перед запуском потребовать clean source fingerprint и сравнить 40-hex commit
   локального `HEAD` (commit B) с commit успешных
   backend **и** frontend deployment в Railway. После всех остальных gate
   генератор последним live-проверяет один exact SHA в backend `/api/health` и
   frontend `/build-info.json`; внешний metadata-аудит Railway остаётся
   дополнительной проверкой. Ожидаемый SHA обязан совпасть с локальным `HEAD`.
   Backend integration DSN должны указывать на две разные
   выделенные disposable PostgreSQL 17 БД, не на production; значения DSN в
   artifact не записываются. `CANONICAL_RUNTIME_TEST_DSN` указывает на свежую
   canonical БД, а `CONTENT_MIGRATION_TEST_DSN` — на отдельный восстановленный
   production-like clone с применёнными migrations и materialized patch. Они не
   могут иметь одинаковые координаты. `CONTENT_MIGRATION_TEST_BOOTSTRAP` должен
   быть снят: release evidence не имеет права создавать тестовый content вместо
   проверки восстановленных данных.

   ```bash
   cd frontend
   MICRO_MVP_API=https://backend-production-41c3.up.railway.app
   MICRO_MVP_FRONTEND=https://bagofholding.up.railway.app
   MICRO_MVP_SOURCE_COMMIT=<40-hex-local-HEAD>
   MICRO_MVP_DEPLOYED_COMMIT=<same-40-hex-verified-in-railway>
   unset CONTENT_MIGRATION_TEST_BOOTSTRAP
   export CANONICAL_RUNTIME_TEST_DSN=<fresh-canonical-postgres-17-dsn>
   export CONTENT_MIGRATION_TEST_DSN=<separate-restored-materialized-postgres-17-dsn>
   npm run content:evidence:micro -- \
     --api "$MICRO_MVP_API" \
     --frontend "$MICRO_MVP_FRONTEND" \
     --source-commit "$MICRO_MVP_SOURCE_COMMIT" \
     --expected-deployed-commit "$MICRO_MVP_DEPLOYED_COMMIT" \
     --artifact ../backups/micro-mvp-production-release-evidence.json
   unset MICRO_MVP_API MICRO_MVP_FRONTEND MICRO_MVP_SOURCE_COMMIT MICRO_MVP_DEPLOYED_COMMIT
   unset CANONICAL_RUNTIME_TEST_DSN CONTENT_MIGRATION_TEST_DSN
   unset CONTENT_MIGRATION_TEST_BOOTSTRAP
   ```

   Artifact пишется атомарно с mode `0600` и связывает exact API и frontend origins,
   byte-exact source-tree, локальный source commit, ожидаемый deployed commit,
   source content, rules/compiled release, patch и полный live catalog. Он
   действителен не более четырёх часов. Неожиданный skip/todo в любом test gate,
   test failure, изменение файла/каталога или редактирование artifact делает
   последующий certification apply невозможным. `API_URL` сам по себе для live
   gate недостаточен; генератор задаёт browser-compatible `VITE_API_URL` явно.
2. В `/rules-lab` и в реальных листах проверить минимум Fighter, Rogue,
   Wizard, Warlock, Sorcerer, Cleric и Druid; reload/offline, ход/цена,
   attack/save/check, condition lifecycle, все 8 mastery и сохранение обоих
   участников.
3. Окно обслуживания пока не снимать: без изменения source/deployment сразу
   перейти к пакетной certification шага 7. Снять окно можно только после
   успешного certification postimage audit exact commit B.

### 7. Пакетная certification micro-MVP

Пакетный CLI по умолчанию работает только на чтение. Он загружает все страницы
каталогов, запрещает неоднозначные `id`/`card_number` и строит ровно 64 записи:
49 core-записей denominator манифеста и 15 condition Effect. Для любого будущего
apply сначала обязателен schema-v2 bundle с полными preimage и certification
version `micro-mvp-l1-rules-core-v3`; `--bundle` не должен существовать,
`--evidence` указывает на свежий artifact из шага 6, а release timestamp
задаётся явно:

Certification bundle и apply выполняются при неизменных local HEAD, Railway
backend/frontend commit и source fingerprint commit B. Если после evidence
появилось любое изменение source, новый commit или deployment, evidence
отбрасывается до первой certification mutation и весь хвост начиная с deploy B
повторяется.

```bash
cd frontend
API_URL=https://backend-production-41c3.up.railway.app \
npm run content:certify:micro -- \
  --bundle ../backups/micro-mvp-production-certification.json \
  --evidence ../backups/micro-mvp-production-release-evidence.json \
  --certified-at 2026-08-06T00:00:00Z
```

Bundle создаётся с mode `0600`, получает UUID и immutable `planHash` и
атомарно сохраняется через temporary file, `fsync` и rename. Он содержит полный
API preimage и SHA-256 каждой из 64 строк. Immutable `planHash` также включает
ID и raw-file SHA-256 evidence, exact API, gate/source/release/patch/catalog
identity. Время certification выбирают один раз; apply не может заменить его
текущим временем или другим `--certified-at`.

```bash
cd frontend
API_URL=https://backend-production-41c3.up.railway.app \
API_TOKEN=... \
CONTENT_CERTIFICATION_KEY=... \
npm run content:certify:micro -- --apply \
  --bundle ../backups/micro-mvp-production-certification.json \
  --evidence ../backups/micro-mvp-production-release-evidence.json \
  --confirm-api https://backend-production-41c3.up.railway.app \
  --certified-at 2026-08-06T00:00:00Z
```

Если `API_TOKEN` не задан, CLI выполняет login только через явно заданные
`CONTENT_ADMIN_USERNAME`/`CONTENT_ADMIN_PASSWORD`; встроенных credentials и автоматической регистрации
нет. Для `--apply`/`--rollback` обязательны непустой
`CONTENT_CERTIFICATION_KEY`, существующий durable bundle и посимвольно
совпадающий с `API_URL` `--confirm-api`.

`--apply` заново читает raw evidence, проверяет mode `0600`, его SHA-256,
четырёхчасовую давность, exact 16-gate contract, отсутствие failures и
неожиданных skip/todo, точное число закреплённых regression TODO, совпадение
source/expected-deployed commit, exact source/release/patch и текущий полный
catalog fingerprint **до login и до первой mutation**. В каждую
support-запись v3 попадают `evidence_id`, `evidence_hash`,
`evidence_completed_at`, `gate_source_hash`, `source_content_hash`,
`rules_hash`, `release_content_hash`, `release_hash`, `patch_hash` и
`catalog_hash`. Backend и browser runtime отвергают неполную v3 запись.

Apply не выполняет 64 отдельных PUT. Клиент сначала проверяет, что все строки
одновременно находятся либо в точных preimage, либо в точных requested
postimage, сохраняет статус `applying` до HTTP-вызова и отправляет один запрос
`POST /api/content-support/batch-exact`. Сервер в одном transaction:

1. блокирует все 64 строки в глобальном порядке `entity_type` + UUID;
2. сверяет полный API response каждой строки, включая исходный `support`;
3. отвергает mixed/third state с `409` до первого UPDATE;
4. обновляет все `support` и post-verify-ит их либо откатывает весь transaction.

Per-row fallback отсутствует. Повтор после потерянного response безопасен:
сервер принимает только all-preimage или all-requested, а CLI повторно читает
полный каталог и сохраняет `apply-failed` либо `apply-outcome-unknown`, если
исход нельзя доказать. После commit CLI сохраняет полные postimage и проверяет
точные `support`, `content_hash` и `dependency_hash` всех 64 записей.

Rollback использует тот же transaction и exact CAS, восстанавливая исходные
`support` как есть — в том числе `null` и nested legacy JSON:

```bash
cd frontend
API_URL=https://backend-production-41c3.up.railway.app \
API_TOKEN=... \
CONTENT_CERTIFICATION_KEY=... \
npm run content:certify:micro -- --rollback \
  --bundle ../backups/micro-mvp-production-certification.json \
  --confirm-api https://backend-production-41c3.up.railway.app
```

Успешный rollback обязан оставить bundle в `rolled-back` и подтвердить полный
preimage каждой строки, исключая только server-managed `updated_at`. Bundle не
редактировать и не удалять до завершения окна и архивирования evidence.

## Когда откатывать

Откатить API bundle, если materialized compiler, live scenario, browser sheet
или postimage audit не проходят. Если точечный rollback отказывается из-за
postimage drift либо обнаружена более широкая порча данных, остановить запись и
восстановить полный SQL dump по disaster-recovery процедуре. Не исправлять hash
pins и не редактировать bundle для маскировки drift.

## Известные границы

- Миграция materializes проверенный срез первого уровня; она не доказывает
  корректность всего PHB/DMG/MM или уровней 2–20.
- Перемещение пока остаётся explicit fact/outcome без полной геометрии.
- Серверный authority общего боя ещё не заменяет локальный rules session; оба
  пути обязаны использовать один rules artifact, а не две реализации правил.
- Подтверждённая persistence-граница sheet runtime-command включает операции
  одного owner-листа и одну атомарную команду над двумя writable owner-листами
  **одного аккаунта**. Команда фиксирует exact participant set, ожидаемые
  `runtime_revision`, UUID idempotency key и блокирует строки в стабильном
  порядке; потерянный response можно безопасно согласовать. Cross-owner и
  online encounter в micro-MVP authority claim не входят.
- Desktop и mobile manual Effect UI используют detached `active_effects` CAS и
  fail-closed блокируются для online-sheet, но state write и event/journal не
  образуют одну общую атомарную semantic command. Desktop отправляет журнал
  отдельным шагом, mobile не создаёт сертифицированную
  `ruleset_ref`/command-оболочку. Поэтому manual effects не являются общей
  semantic authority ни на одной из двух поверхностей.
- Sheet primitive catalog exact release-bound: 12 Weapon Card, 8 Weapon Mastery
  Effect, все требуемые `grant_effect` dependencies и поддержанные no-pending
  primitives валидируются как одна closure. Это не расширяет поддержку на
  pending attack/save/reaction paths.
- Thrown поддержан не полностью: на дистанции не больше reach выбирается melee
  mode, явного выбора melee/thrown в UI нет, а сам брошенный предмет не
  перемещается, не расходуется и не передаётся item-lifecycle primitive.
- Базовые Attack/Weapon Attack/Unarmed Strike/grapple actions пока являются
  frozen definitions в `rules-core/systemActions.ts`, а не Effect-записями БД.
  Это versioned ruleset input для generic handlers, но остаётся честно
  обозначенным исключением из конечной effects-only модели. Следующая миграция
  должна перенести definitions в immutable rules release без создания второго
  набора handler-правил.
- Shared encounter теперь требует `expected_seq`, проверяет ownership и
  сериализует каждую операцию под row lock; stale writer получает `409`.
  Однако backend пока принимает уже рассчитанные client patches и не проверяет
  action/spell provenance, цену, DC или release hash. Сохранение CharacterV3 и
  encounter command также не образует одну межendpoint-транзакцию. Поэтому
  multi-device transport consistency доказана, но shared rules-authority нельзя
  заявлять до server-side command validation/replay с единым rules artifact.
- UI-проверка реальных листов остаётся обязательной: schema и сценарии
  доказывают семантику, но не доступность и понятность управления.
