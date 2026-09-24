param(
    [string]$EnvironmentFile = 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json',
    [string]$GoExecutable = 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$paperRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$paperOutput = Join-Path $paperRoot '.tmp/paper-sheet/catalog-readonly'
New-Item -ItemType Directory -Path $paperOutput -Force | Out-Null
$paperOverlay = Join-Path $paperOutput 'overlay.json'
$paperBinary = Join-Path $paperOutput 'catalog-readonly.exe'
$paperSource = Join-Path $PSScriptRoot 'catalog-readonly-main.go'
$paperOriginalMain = Join-Path $paperRoot 'backend/main.go'
@{ Replace = @{ $paperOriginalMain = $paperSource } } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $paperOverlay -Encoding utf8NoBOM
# The overlay only substitutes the entrypoint while compiling existing handlers.
# No dependency download, .env load, production configuration or migration is run.
$env:GOTOOLCHAIN = 'local'
$env:GOPROXY = 'off'
Push-Location (Join-Path $paperRoot 'backend')
try {
    & $GoExecutable build -mod=readonly -overlay $paperOverlay -o $paperBinary .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($CheckOnly) {
        & $paperBinary -config $EnvironmentFile -check-only
    } else {
        & $paperBinary -config $EnvironmentFile
    }
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
