# Очистка публичной Git history от database dumps

## Статус

В текущем дереве удалены ранее tracked файлы:

- `dump_20251212_083750.sql`;
- `dump_20251212_083829.sql`;
- `dump_20251216_083948.sql`;
- `dump_correct_utf8.sql`;
- `dump_fixed_utf8.sql`.

Также удалён obsolete `fix_dump_encoding.ps1`, который создавал новые копии
этих архивов в корне репозитория.

Три непустых архива содержали auth/session/PII-таблицы. Удаляющий commit не
удаляет байты из старых Git objects. Репозиторий наблюдался доступным через
unauthenticated GitHub API, поэтому история считается раскрытой.

## Обязательные действия владельца

1. На время инцидента сделать repository private и остановить обычные push.
2. Инвалидировать затронутые refresh/session credentials. Текущий application
   `JWT_SECRET` уже должен оставаться ротированным; не восстанавливать старое
   значение из history или dump.
3. Создать отдельный защищённый mirror для аварийного восстановления истории.
4. Согласовать окно, в котором все collaborators прекращают работу.
5. Переписать **все refs** через `git filter-repo --invert-paths`, удалив пять
   путей выше, проверить локальный object database и выполнить coordinated
   force-push branches/tags.
6. Удалить cached PR artifacts/releases, обратиться в GitHub Support для purge
   недостижимых cached objects при необходимости.
7. Попросить всех collaborators удалить старые clones/forks и клонировать
   очищенную историю заново. Обычный merge старой ветки вернёт утечку.
8. Повторить secret/session audit и только затем вернуть выбранную visibility.

Force-push и массовая инвалидация сессий являются разрушительными операциями и
выполняются только после явного подтверждения владельца. CI запускает
`scripts/security/check-no-database-dumps.mjs`, чтобы новый dump снова не попал
в tracked tree.
