param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('api','worker','frontend')]
    [string]$Service,
    [Parameter(Mandatory=$true)]
    [string]$EnvironmentFile,
    [string]$ArtifactsDirectory,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$qaRoot = Split-Path $PSScriptRoot -Parent
$qaConfig = Get-Content -LiteralPath $EnvironmentFile -Raw | ConvertFrom-Json
foreach ($qaSetting in $qaConfig.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($qaSetting.Name, [string]$qaSetting.Value, 'Process')
}
if (!$ArtifactsDirectory) { $ArtifactsDirectory = Join-Path (Split-Path (Resolve-Path -LiteralPath $EnvironmentFile) -Parent) 'rules-artifacts' }
$env:SOURCE_COMMIT = 'local-working-tree'
if ($Service -eq 'api') {
    Set-Location (Join-Path $qaRoot 'backend')
    $env:PORT = '8080'
    $qaBinary = Join-Path (Split-Path (Resolve-Path -LiteralPath $EnvironmentFile) -Parent) 'roguelike-local-api.exe'
    if (!$SkipBuild) {
        go build -o $qaBinary .
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & $qaBinary
} elseif ($Service -eq 'worker') {
    Set-Location (Join-Path $qaRoot 'frontend')
    $env:PORT = '8090'
    $env:RULES_ARTIFACTS_DIR = $ArtifactsDirectory
    if (!$SkipBuild) {
        node worker/build.mjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    node worker/dist/server.mjs
} else {
    Set-Location (Join-Path $qaRoot 'frontend')
    $env:VITE_API_URL = 'http://localhost:8080'
    $env:DEV_API_PROXY_TARGET = 'http://127.0.0.1:8080'
    node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000 --strictPort
}
