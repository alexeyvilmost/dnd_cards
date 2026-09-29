param(
  [string]$EnvironmentFile='C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json',
  [string]$ApiBinary='outputs/account-profile-268-api.exe'
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskConfig=Get-Content -LiteralPath $EnvironmentFile -Raw | ConvertFrom-Json
if(-not ([uri]$taskConfig.DATABASE_URL).IsLoopback){throw 'Local database required'}
foreach($taskSetting in $taskConfig.PSObject.Properties){[Environment]::SetEnvironmentVariable($taskSetting.Name,[string]$taskSetting.Value,'Process')}
$taskDatabase=[UriBuilder]$env:DATABASE_URL
$taskDatabase.Path='shop_review_249_20260915'
$env:DATABASE_URL=$taskDatabase.Uri.AbsoluteUri
$env:CONTENT_ADMIN_USER_IDS='1a58e175-2c11-40eb-bb76-72ca95648c59,0d32095f-0167-4ad0-9bac-5e88077337c7,d3d29f87-e011-446a-b55b-ce2ccd6613a7'
$env:PORT='8080'
$env:RULES_WORKER_URL='http://127.0.0.1:8090'
$env:CORS_ALLOWED_ORIGINS='http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001'
$env:OAUTH_FRONTEND_ORIGIN='http://localhost:3001'
$env:OAUTH_GOOGLE_REDIRECT_URI='http://localhost:8080/api/auth/oauth/google/callback'
$env:OAUTH_YANDEX_REDIRECT_URI='http://localhost:8080/api/auth/oauth/yandex/callback'
$env:YANDEX_CLOUD_BUCKET_NAME='dnd-cards-images'
$env:SOURCE_COMMIT='local-account-268'
foreach($taskLine in Get-Content -LiteralPath (Join-Path $taskRoot '.env')) {
  if($taskLine -match '^\s*(YANDEX_CLOUD_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)|OAUTH_(?:GOOGLE|YANDEX)_(?:CLIENT_ID|CLIENT_SECRET))\s*=\s*(.*?)\s*$') {
    [Environment]::SetEnvironmentVariable($matches[1],$matches[2].Trim('"').Trim("'"),'Process')
  }
}
Set-Location (Join-Path $taskRoot 'backend')
& (Join-Path $taskRoot $ApiBinary)
exit $LASTEXITCODE
