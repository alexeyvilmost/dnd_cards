param(
  [ValidateSet('api','worker','frontend')][string]$Service='api',
  [string]$EnvironmentFile='C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json',
  [ValidateSet('combat_audio_289_20260929')][string]$DatabaseName='combat_audio_289_20260929',
  [string]$ApiBinary='outputs/combat-audio-v2/service/api.exe',
  [ValidateRange(1024,65535)][int]$ApiPort=8083,
  [ValidateRange(1024,65535)][int]$WorkerPort=8093,
  [ValidateRange(1024,65535)][int]$FrontendPort=3003
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskConfig=Get-Content -LiteralPath $EnvironmentFile -Raw | ConvertFrom-Json
if(-not ([uri]$taskConfig.DATABASE_URL).IsLoopback){throw 'Local database required'}
foreach($taskSetting in $taskConfig.PSObject.Properties){[Environment]::SetEnvironmentVariable($taskSetting.Name,[string]$taskSetting.Value,'Process')}
$taskDatabase=[UriBuilder]$env:DATABASE_URL
$taskDatabase.Path=$DatabaseName
$env:DATABASE_URL=$taskDatabase.Uri.AbsoluteUri
$env:PORT=[string]$ApiPort
$env:RULES_WORKER_URL="http://127.0.0.1:$WorkerPort"
$env:CORS_ALLOWED_ORIGINS="http://localhost:$FrontendPort,http://127.0.0.1:$FrontendPort"
$env:OAUTH_FRONTEND_ORIGIN="http://localhost:$FrontendPort"
$env:SOURCE_COMMIT='local-combat-audio-289'
$env:CONTENT_ADMIN_USER_IDS='1a58e175-2c11-40eb-bb76-72ca95648c59,0d32095f-0167-4ad0-9bac-5e88077337c7,d3d29f87-e011-446a-b55b-ce2ccd6613a7'
if($Service -eq 'frontend') {
  $env:VITE_API_URL="http://127.0.0.1:$FrontendPort"
  $env:DEV_API_PROXY_TARGET="http://127.0.0.1:$ApiPort"
  Set-Location (Join-Path $taskRoot 'frontend')
  & 'C:/Users/alexe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' 'node_modules/vite/bin/vite.js' --config vite.config.ts --host 127.0.0.1 --port $FrontendPort --strictPort
  exit $LASTEXITCODE
}
if($Service -eq 'worker') {
  $env:PORT=[string]$WorkerPort
  $env:RULES_ARTIFACT_FILE=Join-Path $taskRoot 'frontend/worker/dist/artifact.cjs'
  $env:RULES_ARTIFACTS_DIR='C:/Users/alexe/AppData/Local/dnd-cards-dev/rules-artifacts'
  & 'C:/Users/alexe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' (Join-Path $taskRoot 'frontend/worker/dist/server.mjs')
  exit $LASTEXITCODE
}
Set-Location (Join-Path $taskRoot 'backend')
& (Join-Path $taskRoot $ApiBinary)
exit $LASTEXITCODE
