# Идентичность данных исходной сборки

`infra/release-content-manifest.json` имеет scope `source-catalog-data`,
`liveDatabase: false`. Это provenance поставляемых исходников, не fingerprint
редактируемой production библиотеки и не runtime frozen-catalog hash.

Детерминированный producer `scripts/release/source-content-manifest.mjs` включает
консервативное надмножество данных: backend Go/JSON/SQL без тестов, включая
миграции и встроенные seed-пакеты; frontend/src и charges JSON/Markdown;
engine/data и officials/canon JSON/SQL/YAML/Markdown/text. Полные правила включены
в сам manifest. Скрытые/временные каталоги и test fixtures исключены; symlink
отклоняется. Пути сортируются, UTF-8 CRLF нормализуется в LF, размер относится
к нормализованным байтам. SHA256 каждого файла сохраняется отдельно.

Команды:

```
node scripts/release/source-content-manifest.mjs write
node scripts/release/source-content-manifest.mjs check
```

`write` обновляет файл manifest и только его хеш в release-build-config,
не включает публикацию. `prepareBuildPlan` требует совпадения текущих исходников,
checked-in manifest и config hash после проверки точного чистого commit.
Изменение или добавление включённого источника без обновления manifest блокирует
сборку. CI использует тот же entrypoint планирования; фиктивный opaque hash больше
не проходит.

Конфигурация первой сборки подготовлена из реально разрешённых image digests
и наблюдённого production ledger:302 observed identities +3 exact source
checksums. По разрешению root `enabled: true` подготовлен для окончательной
проверки ручного первого релиза. Сам флаг не публикует образы; внешние GitHub
переключатели остаются выключенными до завершения gates, auto-main выключен.
Предыдущим образам не приписываются исходные checksum или baked provenance.
