param(
    [string]$EnvironmentFile = 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json',
    [string]$GoExecutable = 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe',
    [ValidateSet(5432, 5434)][int]$DatabasePort = 5432,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$paperRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$paperOutput = Join-Path $paperRoot '.tmp/paper-sheet/document-qa'
New-Item -ItemType Directory -Path $paperOutput -Force | Out-Null
$paperOverlay = Join-Path $paperOutput 'overlay.json'
$paperBinary = Join-Path $paperOutput 'document-qa.exe'
$paperSource = Join-Path $PSScriptRoot 'document-qa-main.go'
$paperOriginalMain = Join-Path $paperRoot 'backend/main.go'
$paperSecret = Join-Path $paperOutput 'local-jwt-key'
@{ Replace = @{ $paperOriginalMain = $paperSource } } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $paperOverlay -Encoding utf8NoBOM
$env:GOTOOLCHAIN = 'local'
$env:GOPROXY = 'off'
Push-Location (Join-Path $paperRoot 'backend')
try {
    & $GoExecutable build -mod=readonly -overlay $paperOverlay -o $paperBinary .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($CheckOnly) {
        & $paperBinary -config $EnvironmentFile -local-secret $paperSecret -database-port $DatabasePort -check-only
    } else {
        & $paperBinary -config $EnvironmentFile -local-secret $paperSecret -database-port $DatabasePort
    }
    exit $LASTEXITCODE
} finally { Pop-Location }
