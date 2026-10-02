param(
    [string]$EnvironmentFile = 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json',
    [string]$PostgresBin = 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin',
    [ValidateSet(5432, 5434)][int]$DatabasePort = 5432
)
$ErrorActionPreference = 'Stop'
$paperRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$paperOutput = Join-Path $paperRoot '.tmp/paper-sheet/document-qa'
$paperSourceDatabase = 'shop_review_249_20260915'
$paperTargetDatabase = 'paper_sheet_20261002_qa'
$paperConfig = Get-Content -LiteralPath $EnvironmentFile -Raw | ConvertFrom-Json
$paperUri = [uri]$paperConfig.DATABASE_URL
if ($paperUri.Scheme -notin @('postgres', 'postgresql') -or !$paperUri.IsLoopback) { throw 'Source credentials must already identify a loopback PostgreSQL server.' }
$paperCredentials = $paperUri.UserInfo.Split(':', 2)
if ($paperCredentials.Count -ne 2) { throw 'Local PostgreSQL credentials are required.' }
$paperUser = [uri]::UnescapeDataString($paperCredentials[0])
$paperPreviousPassword = $env:PGPASSWORD
$paperPreviousOptions = $env:PGOPTIONS
try {
    $env:PGPASSWORD = [uri]::UnescapeDataString($paperCredentials[1])
    $env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=10000'
    $paperMetadata = & "$PostgresBin/psql.exe" -X -w -h 127.0.0.1 -p $DatabasePort -U $paperUser -d $paperSourceDatabase -At -v ON_ERROR_STOP=1 -c "SELECT json_build_object('source',current_database(),'address',host(inet_server_addr()),'port',inet_server_port(),'readonly',current_setting('transaction_read_only'),'bytes',pg_database_size(current_database()),'target_exists',EXISTS(SELECT FROM pg_database WHERE datname='$paperTargetDatabase'));"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the existing source database.' }
    $paperScope = ($paperMetadata -join '') | ConvertFrom-Json
    if ($paperScope.source -ne $paperSourceDatabase -or $paperScope.address -ne '127.0.0.1' -or $paperScope.port -ne $DatabasePort -or $paperScope.readonly -ne 'on') { throw 'Source scope/read-only verification failed.' }
    if ($paperScope.target_exists) { throw "QA database $paperTargetDatabase already exists; it will not be replaced." }
    $paperFreeBytes = (Get-PSDrive -Name ([IO.Path]::GetPathRoot($paperRoot).Substring(0, 1))).Free
    if ($paperFreeBytes -lt ([long]$paperScope.bytes * 3 + 2GB)) { throw 'Insufficient free space for a source snapshot and isolated database copy.' }
    Write-Output "Source is read-only on loopback:$DatabasePort; source bytes=$($paperScope.bytes); free bytes=$paperFreeBytes."
    New-Item -ItemType Directory -Path $paperOutput -Force | Out-Null
    $paperDump = Join-Path $paperOutput 'review-snapshot.dump'
    if (Test-Path -LiteralPath $paperDump) { throw 'A previous QA snapshot exists; it will not be overwritten.' }
    # pg_dump reads the source in its own consistent transaction. No source schema,
    # account or record is changed; the snapshot stays in the ignored local directory.
    $env:PGOPTIONS = '-c default_transaction_read_only=on'
    & "$PostgresBin/pg_dump.exe" -w -h 127.0.0.1 -p $DatabasePort -U $paperUser -d $paperSourceDatabase --format=custom --compress=1 --lock-wait-timeout=10000 --file=$paperDump
    if ($LASTEXITCODE -ne 0) { throw 'Read-only source snapshot failed; source and any partial snapshot are retained.' }
    # Only creation of the explicitly named new QA database and writes to that
    # database are enabled. Existing databases are never dropped or migrated.
    $env:PGOPTIONS = '-c default_transaction_read_only=off'
    & "$PostgresBin/createdb.exe" -w -h 127.0.0.1 -p $DatabasePort -U $paperUser --template=template0 $paperTargetDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the isolated QA database.' }
    & "$PostgresBin/pg_restore.exe" -w -h 127.0.0.1 -p $DatabasePort -U $paperUser -d $paperTargetDatabase --exit-on-error --no-owner --no-acl $paperDump
    if ($LASTEXITCODE -ne 0) { throw 'QA restore failed; the partial QA database is retained and no source data was changed.' }
    $env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=10000'
    & "$PostgresBin/psql.exe" -X -w -h 127.0.0.1 -p $DatabasePort -U $paperUser -d $paperTargetDatabase -At -v ON_ERROR_STOP=1 -c "SELECT current_database(),host(inet_server_addr()),inet_server_port(),to_regclass('public.paper_documents') IS NOT NULL,EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='paper_documents' AND column_name='deleted_at');"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot verify the cloned QA database.' }
    @{ source_database = $paperSourceDatabase; qa_database = $paperTargetDatabase; port = $DatabasePort; prepared_utc = [DateTime]::UtcNow.ToString('o'); source_bytes = $paperScope.bytes; dump_bytes = (Get-Item -LiteralPath $paperDump).Length } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $paperOutput 'clone.json') -Encoding utf8NoBOM
} finally {
    $env:PGPASSWORD = $paperPreviousPassword
    $env:PGOPTIONS = $paperPreviousOptions
}
