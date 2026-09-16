param([string]$EnvironmentFile='C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json')
$ErrorActionPreference='Stop'
$shopRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$shopConfig=Get-Content -LiteralPath $EnvironmentFile -Raw|ConvertFrom-Json
if(-not ([uri]$shopConfig.DATABASE_URL).IsLoopback){throw 'Local database required'}
foreach($shopSetting in $shopConfig.PSObject.Properties){[Environment]::SetEnvironmentVariable($shopSetting.Name,[string]$shopSetting.Value,'Process')}
$shopDatabase=[UriBuilder]$env:DATABASE_URL
$shopDatabase.Path='shop_review_249_20260915'
$env:DATABASE_URL=$shopDatabase.Uri.AbsoluteUri
$env:CONTENT_ADMIN_USER_IDS='1a58e175-2c11-40eb-bb76-72ca95648c59,0d32095f-0167-4ad0-9bac-5e88077337c7,d3d29f87-e011-446a-b55b-ce2ccd6613a7'
$env:PORT='8080';$env:RULES_WORKER_URL='http://127.0.0.1:8090'
$env:CORS_ALLOWED_ORIGINS='http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001'
$env:SOURCE_COMMIT='local-shop-cart-259'
Set-Location (Join-Path $shopRoot 'backend')
& (Join-Path $shopRoot 'outputs/shop-cart-259/api-v2.exe')
exit $LASTEXITCODE
