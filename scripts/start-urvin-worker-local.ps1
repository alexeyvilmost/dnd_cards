param([string]$EnvironmentFile='C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskConfig=Get-Content -LiteralPath $EnvironmentFile -Raw | ConvertFrom-Json
if(-not ([uri]$taskConfig.DATABASE_URL).IsLoopback){throw 'Local configuration required'}
$env:RULES_WORKER_TOKEN=$taskConfig.RULES_WORKER_TOKEN
$env:PORT='8090'
$env:RULES_ARTIFACT_FILE=Join-Path $taskRoot 'frontend/worker/dist/artifact.cjs'
$env:RULES_ARTIFACTS_DIR='C:/Users/alexe/AppData/Local/dnd-cards-dev/rules-artifacts'
$env:SOURCE_COMMIT='local-urvin-273'
& 'C:/Users/alexe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' (Join-Path $taskRoot 'frontend/worker/dist/server.mjs')
exit $LASTEXITCODE
