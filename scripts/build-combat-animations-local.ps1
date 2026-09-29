param(
  [string]$GoExecutable='C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe'
)
# This isolated preview database predates unrelated guarded catalog migrations.
# Preserve those migrations as pending. The local overlay applies only 286 and
# keeps the normal advisory lock, real migration receipt and all API checks.
# Production sources/builds are never modified by this script.
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskOutput=Join-Path $taskRoot 'outputs/combat-animation-286'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskSourcePath=Join-Path $taskRoot 'backend/migrations/migration.go'
$taskSource=Get-Content -LiteralPath $taskSourcePath -Raw
$taskGuard=@'
var localAnimationDatabase bool
	if err := m.db.QueryRow("SELECT current_database()='combat_animation_286_20260929' AND inet_server_addr() IN ('127.0.0.1'::inet,'::1'::inet)").Scan(&localAnimationDatabase); err != nil { return err }
	if !localAnimationDatabase { return fmt.Errorf("animation preview overlay only accepts its named loopback database") }
	ctx := context.Background()
'@
$taskLoop=@'
for _, migration := range GetAllMigrations() {
		if migration.Version != "286_combat_animation_metadata" {
			if !executedMigrations[migration.Version] { log.Printf("LOCAL PREVIEW: leaving unrelated migration pending: %s", migration.Version) }
			continue
		}
'@
if(-not $taskSource.Contains('ctx := context.Background()') -or -not $taskSource.Contains('for _, migration := range GetAllMigrations() {')) {throw 'Migration source changed; review overlay before rebuilding'}
$taskOverlaySource=$taskSource.Replace('ctx := context.Background()',$taskGuard).Replace('for _, migration := range GetAllMigrations() {',$taskLoop)
$taskOverlayPath=Join-Path $taskOutput 'migration.local.go'
$taskManifestPath=Join-Path $taskOutput 'go-overlay.json'
[System.IO.File]::WriteAllText($taskOverlayPath,$taskOverlaySource,[System.Text.UTF8Encoding]::new($false))
$taskReplacements=@{}
$taskReplacements[$taskSourcePath]=$taskOverlayPath
[System.IO.File]::WriteAllText($taskManifestPath,(@{Replace=$taskReplacements}|ConvertTo-Json -Depth 4),[System.Text.UTF8Encoding]::new($false))
$env:GOCACHE=Join-Path $taskRoot 'outputs/go-cache'
Push-Location (Join-Path $taskRoot 'backend')
try {
  & $GoExecutable build -overlay $taskManifestPath -o (Join-Path $taskOutput 'api.exe') .
  if($LASTEXITCODE -ne 0){throw 'Local animation API build failed'}
} finally {Pop-Location}
