param([string]$EnvironmentFile='C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$taskConfig=Get-Content -LiteralPath $EnvironmentFile -Raw|ConvertFrom-Json
if(-not ([uri]$taskConfig.DATABASE_URL).IsLoopback){throw 'Local database required'}
foreach($taskSetting in $taskConfig.PSObject.Properties){[Environment]::SetEnvironmentVariable($taskSetting.Name,[string]$taskSetting.Value,'Process')}
$taskDatabase=[UriBuilder]$env:DATABASE_URL
$taskDatabase.Path='shop_review_249_20260915'
$env:DATABASE_URL=$taskDatabase.Uri.AbsoluteUri
$env:CONTENT_ADMIN_USER_IDS='1a58e175-2c11-40eb-bb76-72ca95648c59,0d32095f-0167-4ad0-9bac-5e88077337c7,d3d29f87-e011-446a-b55b-ce2ccd6613a7'
$env:PORT='8080'
$env:RULES_WORKER_URL='http://127.0.0.1:8090'
$env:CORS_ALLOWED_ORIGINS='http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001'
$env:SOURCE_COMMIT='local-entity-tags-258'
Set-Location (Join-Path $taskRoot 'backend')
& (Join-Path $taskRoot 'outputs/entity-tags-258/api-v3.exe')
exit $LASTEXITCODE
