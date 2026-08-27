# Выкатка на standalone-сервер после commit и push

Эта инструкция описывает production-деплой текущей архитектуры Bag of Holding
на обычный Linux-сервер без Railway. Она рассчитана на уже подготовленный
сервер и повторяемый выпуск новой версии из `main`.

## Что считается релизом

Релизом является точный 40-символьный Git SHA, а не состояние рабочей папки и
не имя ветки. Backend, frontend и `origin/main` после выкладки должны сообщать
один и тот же SHA.

Текущая production-конфигурация:

| Параметр | Значение |
| --- | --- |
| Сервер | `root@77.95.206.239` |
| Домен | `bagofholding.ru` |
| Корень приложения | `/opt/bagofholding` |
| Активный релиз | `/opt/bagofholding/current` — symlink на каталог в `releases/` |
| Секреты приложения | `/opt/bagofholding/shared/app.env` |
| Параметры Compose | `/opt/bagofholding/shared/deploy.env` |
| Резервные копии БД | `/opt/bagofholding/shared/backups/` |

В Compose входят Caddy, Go backend и nginx frontend. PostgreSQL находится вне
Compose и доступен по `DATABASE_URL`.

## Инварианты безопасной выкладки

1. Выкладывается только commit, уже отправленный в `origin/main`.
2. Docker build получает содержимое через `git archive <SHA>`, поэтому локальные
   незакоммиченные и неотслеживаемые файлы в образ не попадают.
3. До запуска нового backend создаётся `pg_dump` production-БД.
4. Новый каталог релиза не перезаписывает старый.
5. Symlink `current` переключается атомарно.
6. При неуспешном health-check Compose автоматически возвращается к предыдущему
   релизу.
7. Backend `/api/health` и frontend `/build-info.json` обязаны вернуть точный
   SHA нового релиза.
8. Откат приложения не откатывает БД. Миграции должны быть совместимы с
   предыдущей версией по expand/contract-схеме.

## Одноразовая подготовка сервера

На сервере должны быть установлены:

- Docker Engine;
- Docker Compose plugin с поддержкой `up --wait`;
- `curl`, `flock`, `sha256sum` и OpenSSH;
- открытые TCP-порты 80 и 443, а также UDP 443 для HTTP/3;
- DNS `A`/`AAAA` домена, указывающий на сервер.

Структура каталогов:

```sh
install -d -m 755 /opt/bagofholding/bin
install -d -m 755 /opt/bagofholding/builds
install -d -m 755 /opt/bagofholding/releases
install -d -m 700 /opt/bagofholding/shared
install -d -m 700 /opt/bagofholding/shared/backups
```

`/opt/bagofholding/shared/app.env` хранится только на сервере с правами `0600`.
Минимальный шаблон без реальных значений:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
JWT_SECRET=<случайный секрет не короче 32 байт>
ENCOUNTER_INVITE_SECRET=<отдельный случайный секрет не короче 32 байт>
CONTENT_CERTIFICATION_KEY=<случайный ключ сертификации контента>
CONTENT_ADMIN_USER_IDS=<UUID администраторов через запятую>
CORS_ALLOWED_ORIGINS=https://bagofholding.ru

OPENAI_API_KEY=<опционально>
OPENAI_MECHANICS_MODEL=<опционально>

YANDEX_CLOUD_ACCESS_KEY_ID=<ключ Object Storage>
YANDEX_CLOUD_SECRET_ACCESS_KEY=<секрет Object Storage>
YANDEX_CLOUD_BUCKET_NAME=<bucket>
YANDEX_CLOUD_REGION=ru-central1
YANDEX_CLOUD_ENDPOINT=https://storage.yandexcloud.net
```

```sh
chmod 600 /opt/bagofholding/shared/app.env
```

`/opt/bagofholding/shared/deploy.env` не содержит прикладных секретов:

```dotenv
APP_DOMAIN=bagofholding.ru
SOURCE_COMMIT=0000000000000000000000000000000000000000
APP_ENV_FILE=/opt/bagofholding/shared/app.env
```

```sh
chmod 600 /opt/bagofholding/shared/deploy.env
```

### Серверный deploy-runner

Следующий runner устанавливается один раз как
`/opt/bagofholding/bin/deploy-release`. Он ожидает загруженный архив
`/opt/bagofholding/builds/<SHA>.tar`. Каноническая версия runner хранится в
`infra/deploy-release`; листинг ниже показывает его основные шаги.

```sh
#!/bin/sh
set -eu

sha="${1:-}"
case "$sha" in
  ''|*[!0-9a-f]*)
    echo "usage: deploy-release <40-char-lowercase-git-sha>" >&2
    exit 2
    ;;
esac
[ "${#sha}" -eq 40 ] || {
  echo "release SHA must contain exactly 40 characters" >&2
  exit 2
}

root=/opt/bagofholding
archive="$root/builds/$sha.tar"
build_root="$root/builds/$sha"
release="$root/releases/$sha"
app_env="$root/shared/app.env"
deploy_env="$root/shared/deploy.env"
backup_dir="$root/shared/backups"
backup_file="$backup_dir/pre-$sha-$(date -u +%Y%m%dT%H%M%SZ).dump"
lock_file="$root/shared/deploy.lock"

exec 9>"$lock_file"
flock -n 9 || {
  echo "another deployment is already running" >&2
  exit 1
}

test -f "$archive"
test -f "$app_env"
test -f "$deploy_env"
test -L "$root/current"
test ! -e "$build_root"
test ! -e "$release"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
umask 077

echo "[1/7] Backing up production PostgreSQL"
docker run --rm \
  --env-file "$app_env" \
  postgres:17-alpine \
  sh -eu -c 'test -n "${DATABASE_URL:-}"; exec pg_dump --format=custom --dbname="$DATABASE_URL"' \
  > "$backup_file"
test -s "$backup_file"

echo "[2/7] Extracting immutable release archive"
mkdir "$build_root"
tar -xf "$archive" -C "$build_root"

echo "[3/7] Building backend and frontend images"
docker build -t "bagofholding-backend:$sha" "$build_root/backend"
# Пустой VITE_API_URL означает same-origin /api через Caddy.
docker build \
  --build-arg VITE_API_URL= \
  -t "bagofholding-frontend:$sha" \
  "$build_root/frontend"

echo "[4/7] Preparing release directory"
mkdir "$release"
cp "$build_root/infra/compose.prod.yml" "$release/compose.prod.yml"
cp "$build_root/infra/Caddyfile" "$release/Caddyfile"

old_release=$(readlink -f "$root/current")
deploy_env_backup="$root/shared/deploy.env.pre-$sha"
test ! -e "$deploy_env_backup"
cp "$deploy_env" "$deploy_env_backup"

normalized_env="$root/shared/deploy.env.$sha.normalized"
tr -d '\r' < "$deploy_env" > "$normalized_env"
deploy_env_tmp="$root/shared/deploy.env.$sha.tmp"
if grep -q '^SOURCE_COMMIT=' "$normalized_env"; then
  sed "s/^SOURCE_COMMIT=.*/SOURCE_COMMIT=$sha/" "$normalized_env" > "$deploy_env_tmp"
else
  cp "$normalized_env" "$deploy_env_tmp"
  printf 'SOURCE_COMMIT=%s\n' "$sha" >> "$deploy_env_tmp"
fi
chmod 600 "$deploy_env_tmp"
mv "$deploy_env_tmp" "$deploy_env"
rm -f "$normalized_env"

domain_list=$(tr -d '\r' < "$deploy_env" | sed -n 's/^APP_DOMAIN=//p' | head -n 1)
domain=$(printf '%s\n' "$domain_list" | cut -d, -f1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
test -n "$domain"
case "$domain" in
  http://*|https://*) public_origin=$domain ;;
  *) public_origin="https://$domain" ;;
esac

rollback() {
  echo "Deployment failed; restoring $old_release" >&2
  rollback_link="$root/current.rollback.$sha"
  ln -s "$old_release" "$rollback_link"
  mv -Tf "$rollback_link" "$root/current"
  cp "$deploy_env_backup" "$deploy_env"
  cd "$root/current"
  docker compose --env-file "$deploy_env" -f compose.prod.yml up -d --wait
}

echo "[5/7] Atomically switching current release"
next_link="$root/current.$sha"
ln -s "$release" "$next_link"
mv -Tf "$next_link" "$root/current"

echo "[6/7] Starting containers and waiting for health checks"
cd "$root/current"
if ! docker compose --env-file "$deploy_env" -f compose.prod.yml up -d --wait; then
  rollback
  exit 1
fi

verify_release() {
  backend_commit=$(
    curl -fsS "$public_origin/api/health" \
      | sed -n 's/.*"source_commit":"\([0-9a-f]\{40\}\)".*/\1/p'
  )
  frontend_commit=$(
    curl -fsS "$public_origin/build-info.json" \
      | sed -n 's/.*"source_commit":"\([0-9a-f]\{40\}\)".*/\1/p'
  )
  [ "$backend_commit" = "$sha" ] && [ "$frontend_commit" = "$sha" ]
}

echo "[7/7] Verifying public release identity"
if ! verify_release; then
  rollback
  exit 1
fi

echo "DEPLOYED $sha"
echo "Database backup: $backup_file"
```

После копирования runner:

```sh
chmod 700 /opt/bagofholding/bin/deploy-release
```

Runner рассчитан на уже инициализированный production, где `current` указывает
на последний рабочий релиз. Первый bootstrap выполняется отдельно.

## Повторяемая выкатка после commit и push

Все команды этого раздела выполняются локально в PowerShell из корня
репозитория.

### 1. Убедиться, что выкладывается точный `origin/main`

```powershell
git fetch origin main

$TrackedChanges = git status --porcelain --untracked-files=no
if ($TrackedChanges) {
    throw "Есть незакоммиченные tracked-файлы; релиз остановлен"
}

$Sha = (git rev-parse HEAD).Trim().ToLowerInvariant()
$RemoteSha = (git rev-parse origin/main).Trim().ToLowerInvariant()
if ($Sha -notmatch '^[0-9a-f]{40}$') {
    throw "Некорректный Git SHA: $Sha"
}
if ($Sha -ne $RemoteSha) {
    throw "HEAD=$Sha не совпадает с origin/main=$RemoteSha"
}
```

Неотслеживаемые локальные изображения и временные файлы не мешают этому
процессу: `git archive` их не включает. Незакоммиченные изменения tracked-файлов
блокируют релиз, даже если формально не попадут в архив.

### 2. Пройти обязательные проверки до выкладки

Минимальный локальный барьер:

```powershell
Push-Location backend
go test ./...
go vet ./...
Pop-Location

Push-Location frontend
npm test -- --run
npm run lint
npm run build
$env:CI = '1'
node node_modules/@playwright/test/cli.js test --reporter=line
Remove-Item Env:CI
Pop-Location
```

Для сертифицируемого релиза дополнительно используется полный
`scripts/content/generate-micro-mvp-release-evidence.mjs` с изолированными
PostgreSQL DSN. Финальный deployment-health gate этого сценария запускается уже
после переключения production на новый SHA.

### 3. Создать архив ровно из commit и загрузить его

```powershell
$Server = 'root@77.95.206.239'
$SshKey = 'C:\Users\Алексей\.ssh\bagofholding_timeweb_ed25519'
$TempDir = Join-Path $env:TEMP ("bagofholding-deploy-" + [guid]::NewGuid())
$Archive = Join-Path $TempDir "$Sha.tar"

New-Item -ItemType Directory -Path $TempDir | Out-Null
git archive --format=tar -o $Archive $Sha
if ($LASTEXITCODE -ne 0) {
    throw "git archive завершился с ошибкой"
}

$LocalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash.ToLowerInvariant()
scp -i $SshKey $Archive "${Server}:/opt/bagofholding/builds/$Sha.tar"
if ($LASTEXITCODE -ne 0) {
    throw "scp завершился с ошибкой"
}

$RemoteHash = (
    ssh -i $SshKey $Server "sha256sum /opt/bagofholding/builds/$Sha.tar | cut -d ' ' -f 1"
).Trim().ToLowerInvariant()
if ($LocalHash -ne $RemoteHash) {
    throw "SHA-256 архива не совпал: local=$LocalHash remote=$RemoteHash"
}
```

### 4. Запустить серверный runner

```powershell
ssh -tt -i $SshKey $Server "/opt/bagofholding/bin/deploy-release $Sha"
if ($LASTEXITCODE -ne 0) {
    throw "Standalone deployment завершился с ошибкой"
}
```

На этом шаге runner последовательно:

1. блокирует параллельный деплой;
2. создаёт custom-format дамп PostgreSQL;
3. собирает два Docker image с тегом Git SHA;
4. создаёт новый immutable release directory;
5. меняет `SOURCE_COMMIT` и symlink `current`;
6. ждёт health-check всех контейнеров;
7. проверяет SHA через публичный HTTPS;
8. автоматически возвращает старый релиз при ошибке.

### 5. Независимо проверить production

```powershell
$Backend = Invoke-RestMethod 'https://bagofholding.ru/api/health'
$Frontend = Invoke-RestMethod 'https://bagofholding.ru/build-info.json'

if ($Backend.status -ne 'ok') {
    throw "Backend unhealthy"
}
if ($Backend.source_commit -ne $Sha) {
    throw "Backend сообщает $($Backend.source_commit), ожидался $Sha"
}
if ($Frontend.source_commit -ne $Sha) {
    throw "Frontend сообщает $($Frontend.source_commit), ожидался $Sha"
}

ssh -i $SshKey $Server "readlink -f /opt/bagofholding/current"
```

Ожидаемый target symlink:

```text
/opt/bagofholding/releases/<SHA>
```

### 6. Завершить вторую фазу: evidence и certification

Переключение контейнеров на exact SHA — только первая фаза релиза. Миграции
могут намеренно отозвать старый `support`, поэтому зелёные health-check и SHA не
означают, что production уже готов обслуживать сертифицированные правила.
После изменения release identity такой deployment остаётся maintenance/release
candidate и не считается закрытым production-релизом, пока общий composed
readiness не станет зелёным. CI при этом только наблюдает и никогда не пишет
сертификаты.
Вторая фаза выполняется на неизменном SHA и в таком порядке:

1. сформировать новый micro-MVP release-evidence artifact для этого deployed SHA
   по процедуре из
   [`micro-mvp-production-content-migration.md`](micro-mvp-production-content-migration.md);
2. создать, проверить и атомарно применить micro-v4 certification bundle с тем
   же evidence и `certified_at`;
3. после проверки Forge evidence обновить только ещё не покрытые Forge-корни;
4. выполнить общий read-only readiness predicate;
5. только затем запускать production UX spine.

Micro-v4 и Forge-v2 используют одно поле `support`. Поэтому Forge-инструмент
никогда не заменяет валидный micro-v4 postimage текущего release/evidence:
`--all` означает все оставшиеся корни, а не безусловную перезапись 72 строк.
`--missing-only` выбирает исключительно `null`/отсутствующий `support`.
Старый ненулевой сертификат с несовпавшим release или хэшами можно обновить
только явно через `--all` либо `--card-number` после проверки evidence.

Пример операторского хвоста из `frontend` (пути artifact и timestamp выбираются
один раз на окно релиза; DSN и certification credentials берутся только из
секретного хранилища):

```powershell
$env:MVP_CONTENT = '1'
$env:VITE_API_URL = 'https://bagofholding.ru'
$env:API_URL = 'https://bagofholding.ru'
$CertifiedAt = '<UTC-RFC3339-certification-time>'
$Evidence = '../backups/micro-mvp-production-release-evidence.json'
$Bundle = '../backups/micro-mvp-production-certification.json'

# Полный evidence gate с --source-commit и --expected-deployed-commit $Sha
# выполняется по канонической процедуре micro-mvp-production-content-migration.md.

npm run content:certify:micro -- `
  --bundle $Bundle `
  --evidence $Evidence `
  --certified-at $CertifiedAt
npm run content:certify:micro -- --apply `
  --bundle $Bundle `
  --evidence $Evidence `
  --confirm-api https://bagofholding.ru `
  --certified-at $CertifiedAt

# Только после просмотра актуального Forge evidence этого же release.
node ../scripts/content/mark-mini-mvp-forge-sheet-roots.mjs `
  --apply --all --certified-at $CertifiedAt

npm run test:production:certification-readiness
```

Последняя команда выполняет только GET: она требует 15 состояний БД, которые
реальный runtime loader принимает для текущих compiled pins, и 72 Forge-корня,
каждый из которых покрыт exact Forge-v2 либо более сильным current-release
micro-v4 postimage из того же evidence apply. Она не логинится и ничего не
сертифицирует автоматически.

### 7. Пройти production UX spine до закрытия релиза

Health-check подтверждает доступность контейнеров, но не пользовательский путь.
Из `frontend` запустить однопользовательский canary с canary-учётной записью из
секретного хранилища (не записывать пароль в репозиторий или shell history):

```powershell
$env:LIVE_BROWSER_CANARY = '1'
$env:LIVE_BROWSER_BASE_URL = 'https://bagofholding.ru'
$env:LIVE_BROWSER_API_URL = 'https://bagofholding.ru'
$env:EXPECTED_DEPLOYED_COMMIT = $Sha
$env:LIVE_BROWSER_USER_A = '<canary-user-from-secret-store>'
$env:LIVE_BROWSER_PASSWORD_A = '<canary-password-from-secret-store>'

Push-Location frontend
npm run test:browser:live:typecheck
npm run test:browser:live:nightly
Pop-Location
Remove-Item Env:LIVE_BROWSER_PASSWORD_A
```

Проверка создаёт и удаляет только своих временных персонажей. Она проходит три
независимых пути: lineage + дальнобойная атака + реакция, martial + заклинание и
полный заклинатель + world-domain spell. Каждый путь начинается с реальных
контролов Кузни и проверяет наблюдаемый результат механики, а не только наличие
кнопки. Красный canary означает незавершённый релиз и требует исправления либо
отката; зелёные `/health` и `build-info.json` не могут его заменить. Тот же
набор запускает `live-browser-spine` в GitHub Actions ночью и вручную с input
`expected_deployed_commit`. Push в `main` также запускает этот job автоматически:
после офлайн-гейта он до 45 минут ждёт появления exact SHA в production, затем
ограниченное время повторяет **read-only** certification-readiness и только после
него выполняет те же три пути. CI не получает certification credentials и не
исправляет `support`: незавершённая вторая фаза оставляет job красным, а последний
диагностический отчёт сохраняется рядом с browser artifacts. Поэтому невыкаченный
SHA, несовпавший certificate release и выкаченный, но сломанный UX одинаково
блокируют закрытие релиза.

После успешной проверки временный локальный каталог можно удалить:

```powershell
$ResolvedTemp = [IO.Path]::GetFullPath($TempDir)
$ResolvedSystemTemp = [IO.Path]::GetFullPath($env:TEMP)
$TempPrefix = $ResolvedSystemTemp.TrimEnd('\') + '\'
if (-not $ResolvedTemp.StartsWith($TempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Отказ удалять каталог вне TEMP: $ResolvedTemp"
}
Remove-Item -LiteralPath $ResolvedTemp -Recurse -Force
```

## Ручной rollback

Автоматический rollback выполняется при ошибке запуска или identity-check.
Ручной rollback нужен, если дефект обнаружился после успешной выкладки.

Сначала определить предыдущий рабочий SHA:

```sh
ls -1dt /opt/bagofholding/releases/*
```

Затем на сервере, явно подставив полный `PREVIOUS_SHA`:

```sh
set -eu
root=/opt/bagofholding
PREVIOUS_SHA=<40-символьный SHA предыдущего рабочего релиза>
previous="$root/releases/$PREVIOUS_SHA"

test -d "$previous"
test -f "$previous/compose.prod.yml"
test -f "$previous/Caddyfile"

rollback_link="$root/current.manual-rollback.$PREVIOUS_SHA"
ln -s "$previous" "$rollback_link"
mv -Tf "$rollback_link" "$root/current"

deploy_env="$root/shared/deploy.env"
deploy_env_tmp="$root/shared/deploy.env.rollback.tmp"
tr -d '\r' < "$deploy_env" \
  | sed "s/^SOURCE_COMMIT=.*/SOURCE_COMMIT=$PREVIOUS_SHA/" \
  > "$deploy_env_tmp"
chmod 600 "$deploy_env_tmp"
mv "$deploy_env_tmp" "$deploy_env"

cd "$root/current"
docker compose --env-file "$deploy_env" -f compose.prod.yml up -d --wait
```

После rollback снова проверить оба identity endpoint. Базу данных автоматически
не восстанавливать: новый backend мог уже применить миграции. Восстановление из
`pre-<SHA>-<UTC>.dump` является отдельной аварийной процедурой и требует явного
решения о потере записей, сделанных после дампа.

## Диагностика

Состояние сервисов:

```sh
cd /opt/bagofholding/current
docker compose --env-file /opt/bagofholding/shared/deploy.env \
  -f compose.prod.yml ps
```

Последние логи:

```sh
cd /opt/bagofholding/current
docker compose --env-file /opt/bagofholding/shared/deploy.env \
  -f compose.prod.yml logs --tail=200 backend frontend caddy
```

Публичные проверки:

```sh
curl -fsS https://bagofholding.ru/_edge-health
curl -fsS https://bagofholding.ru/api/health
curl -fsS https://bagofholding.ru/build-info.json
```

Резервные копии и активный релиз:

```sh
find /opt/bagofholding/shared/backups -maxdepth 1 -type f -name '*.dump' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort
readlink -f /opt/bagofholding/current
```

## Что нельзя делать

- Не собирать production из незакоммиченной рабочей директории через `scp -r`.
- Не использовать `latest` вместо полного SHA в тегах image.
- Не хранить `app.env`, дампы БД или приватный SSH-ключ в Git.
- Не менять `current` до успешной сборки обоих image и создания дампа.
- Не удалять предыдущий рабочий release/image до проверки новой версии.
- Не считать rollback приложения rollback-ом базы данных.
- Не запускать два deploy-runner одновременно.
