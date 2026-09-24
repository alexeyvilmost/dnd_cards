param([string]$EnvironmentFile='C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json',
 [string]$ApiBinary='outputs/audio-260/api.exe', [string]$SourceCommit='local-audio-260')
$ErrorActionPreference='Stop'
$audioRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$audioConfig=Get-Content -LiteralPath $EnvironmentFile -Raw|ConvertFrom-Json
if(-not ([uri]$audioConfig.DATABASE_URL).IsLoopback){throw 'Local database required'}
foreach($audioSetting in $audioConfig.PSObject.Properties){[Environment]::SetEnvironmentVariable($audioSetting.Name,[string]$audioSetting.Value,'Process')}
$audioDatabase=[UriBuilder]$env:DATABASE_URL
$audioDatabase.Path='shop_review_249_20260915'
$env:DATABASE_URL=$audioDatabase.Uri.AbsoluteUri
# Preserve the existing local admin allowlist; no role changes in the DB.
$env:CONTENT_ADMIN_USER_IDS='1a58e175-2c11-40eb-bb76-72ca95648c59,0d32095f-0167-4ad0-9bac-5e88077337c7,d3d29f87-e011-446a-b55b-ce2ccd6613a7'
foreach($audioLine in Get-Content -LiteralPath (Join-Path $audioRoot '.env')){
 if($audioLine -match '^\s*(YANDEX_CLOUD_[A-Z_]+|OAUTH_FRONTEND_ORIGIN|OAUTH_(?:GOOGLE|YANDEX)_(?:CLIENT_ID|CLIENT_SECRET|REDIRECT_URI))\s*=\s*(.*?)\s*$'){
  [Environment]::SetEnvironmentVariable($matches[1],$matches[2].Trim('"').Trim("'"),'Process')
 }
}
# OAuth secrets stay in the backend process, never in frontend VITE_* settings.
if(!$env:OAUTH_FRONTEND_ORIGIN){$env:OAUTH_FRONTEND_ORIGIN='http://localhost:3001'}
foreach($oauthLocalUrl in @($env:OAUTH_FRONTEND_ORIGIN,$env:OAUTH_GOOGLE_REDIRECT_URI,$env:OAUTH_YANDEX_REDIRECT_URI)){
 if($oauthLocalUrl -and -not ([uri]$oauthLocalUrl).IsLoopback){throw 'Local OAuth origins and callbacks required'}
}
if(!$env:YANDEX_CLOUD_BUCKET_NAME){$env:YANDEX_CLOUD_BUCKET_NAME='dnd-cards-images'}
$env:PORT='8080';$env:RULES_WORKER_URL='http://127.0.0.1:8090'
$env:CORS_ALLOWED_ORIGINS='http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001'
$env:SOURCE_COMMIT=$SourceCommit
Set-Location (Join-Path $audioRoot 'backend')
& (Join-Path $audioRoot $ApiBinary)
exit $LASTEXITCODE
