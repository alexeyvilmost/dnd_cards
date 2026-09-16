# Undo the accidental migration of the inactive local environment-file DB.
# Keep the entire post-migration database under a recovery name; delete nothing.
$ErrorActionPreference='Stop'
$taskConfig=Get-Content 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json' -Raw|ConvertFrom-Json
$taskDb=[UriBuilder]$taskConfig.DATABASE_URL
if(-not $taskDb.Uri.IsLoopback -or $taskDb.Path -ne '/dnd_cards'){throw 'Unexpected database; refusing recovery'}
$taskDb.Path='postgres'
$taskBin='C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin'
$taskBackup='C:/Projects/dnd_cards/outputs/entity-tags-258/before.dump'
if(-not (Test-Path -LiteralPath $taskBackup)){throw 'Missing pre-change backup'}
& "$taskBin/psql.exe" $taskDb.Uri.AbsoluteUri -X -v ON_ERROR_STOP=1 -c "ALTER DATABASE dnd_cards RENAME TO dnd_cards_tags_258_recovery;"
if($LASTEXITCODE -ne 0){throw 'Could not preserve recovery database'}
& "$taskBin/psql.exe" $taskDb.Uri.AbsoluteUri -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE dnd_cards TEMPLATE template0;"
if($LASTEXITCODE -ne 0){throw 'Could not create restored database'}
$taskDb.Path='dnd_cards'
& "$taskBin/pg_restore.exe" -d $taskDb.Uri.AbsoluteUri --exit-on-error $taskBackup
if($LASTEXITCODE -ne 0){throw 'Restore failed; both recovery database and backup remain available'}
Write-Output 'Inactive local database restored; post-change recovery copy retained.'
