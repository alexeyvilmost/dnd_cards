param(
  [Parameter(Mandatory=$true)][ValidateSet('api','worker','frontend')][string]$Service,
  [Parameter(Mandatory=$true)][string]$EnvironmentFile,
  [ValidatePattern('^[a-z][a-z0-9_]*$')][string]$DatabaseName = 'shop_review_249_20260915',
  [string]$AdminUserIDs = '',
  [string]$GoExecutable = 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe'
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskConfig=Get-Content -LiteralPath $EnvironmentFile -Raw | ConvertFrom-Json
foreach($taskSetting in $taskConfig.PSObject.Properties){[Environment]::SetEnvironmentVariable($taskSetting.Name,[string]$taskSetting.Value,'Process')}
$taskDatabase=[System.UriBuilder]$env:DATABASE_URL
if(!$taskDatabase.Uri.IsLoopback){throw 'This launcher only accepts a loopback database'}
$taskDatabase.Path=$DatabaseName
$env:DATABASE_URL=$taskDatabase.Uri.AbsoluteUri
$env:CONTENT_ADMIN_USER_IDS=$AdminUserIDs
$env:CORS_ALLOWED_ORIGINS='http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001'
$env:RULES_WORKER_URL='http://127.0.0.1:8090'
$env:SOURCE_COMMIT='local-ui-polish-252'
$env:GOCACHE=Join-Path $taskRoot 'outputs/go-cache'
if($Service -eq 'api'){
  Set-Location (Join-Path $taskRoot 'backend')
  $env:PORT='8080'
  $taskBinary=Join-Path $taskRoot 'outputs/ui-polish-252/api.exe'
  & $GoExecutable build -o $taskBinary .
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & $taskBinary
} elseif($Service -eq 'worker') {
  Set-Location (Join-Path $taskRoot 'frontend')
  $env:PORT='8090'
  $env:RULES_ARTIFACTS_DIR=Join-Path $taskRoot 'outputs/rules-artifacts-251'
  node worker/build.mjs
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  node worker/dist/server.mjs
} else {
  Set-Location (Join-Path $taskRoot 'frontend')
  $env:VITE_API_URL='/'
  $env:DEV_API_PROXY_TARGET='http://127.0.0.1:8080'
  node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3001 --strictPort
}
exit $LASTEXITCODE
