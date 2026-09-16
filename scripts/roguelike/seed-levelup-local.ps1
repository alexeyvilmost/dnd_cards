param([Parameter(Mandatory=$true)][Guid]$RunId,[Parameter(Mandatory=$true)][Guid]$OwnerId,[ValidateSet(300,900)][int]$Experience)
$ErrorActionPreference='Stop'
$taskConfig=Get-Content 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json' -Raw|ConvertFrom-Json
$taskDb=[UriBuilder]$taskConfig.DATABASE_URL
if(!$taskDb.Uri.IsLoopback){throw 'Only local QA database is allowed'}
$taskDb.Path='shop_review_249_20260915'
# Only a fresh QA-owned camp, never battle journals or another user's character.
$taskSQL="UPDATE roguelike_runs r SET experience=$Experience,revision=revision+1 WHERE r.id='$RunId'::uuid AND r.user_id='$OwnerId'::uuid AND phase='camp' AND status='active' AND EXISTS(SELECT 1 FROM users u WHERE u.id=r.user_id AND u.username LIKE '%qa%') RETURNING r.id;"
& 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin/psql.exe' $taskDb.Uri.AbsoluteUri -v ON_ERROR_STOP=1 -At -c $taskSQL
if($LASTEXITCODE -ne 0){throw 'QA fixture failed'}
