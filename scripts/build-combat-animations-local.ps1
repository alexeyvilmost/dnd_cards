param(
  [string]$GoExecutable='C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe',
  [string]$OutputDirectory='outputs/combat-animation-critical/service'
)
# This isolated preview database predates unrelated guarded catalog migrations.
# Preserve those migrations as pending. The local overlay applies only 286–288/290/292 and
# keeps the normal advisory lock, real migration receipt and all API checks.
# Production sources/builds are never modified by this script.
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskOutput=Join-Path $taskRoot $OutputDirectory
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
		if migration.Version != "286_combat_animation_metadata" && migration.Version != "287_combat_animation_coverage" && migration.Version != "288_force_animation_palette" && migration.Version != "290_critical_weapon_animations" && migration.Version != "292_critical_spell_animations" {
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
# This dated preview intentionally leaves audio migrations 289/291 pending.
# Retain its previous audio routes in the binary so unrelated in-progress audio
# source changes cannot query columns missing from this isolated database.
$taskAudioBaselineRef='49edbae099ab211fc620253830213bcaf1eb7056'
$taskAudioSource=(& git -C $taskRoot show "${taskAudioBaselineRef}:backend/audio_controller.go") -join "`n"
if($LASTEXITCODE -ne 0 -or -not $taskAudioSource.Contains('type AudioCue struct {')) {throw 'Cannot load the verified preview audio baseline'}
$taskAudioOverlayPath=Join-Path $taskOutput 'audio_controller.local.go'
[System.IO.File]::WriteAllText($taskAudioOverlayPath,$taskAudioSource,[System.Text.UTF8Encoding]::new($false))
$taskReplacements[(Join-Path $taskRoot 'backend/audio_controller.go')]=$taskAudioOverlayPath
# An unrelated music migration may be edited concurrently before its frozen
# seed exists. It is outside this preview allowlist; never supply fake seed data.
# Its local stub fails closed if unexpectedly called and leaves the real file intact.
$taskMusicSourcePath=Join-Path $taskRoot 'backend/migrations/audio_291.go'
if((Test-Path -LiteralPath $taskMusicSourcePath) -and -not (Test-Path -LiteralPath (Join-Path $taskRoot 'backend/migrations/audio_291_seed.json'))) {
  $taskMusicOverlayPath=Join-Path $taskOutput 'audio_291.local.go'
  $taskMusicStub=@'
package migrations
import ("database/sql"; "fmt")
func installExpandedMusic291(db *sql.DB) error { return fmt.Errorf("music migration 291 is unavailable in the isolated animation preview") }
'@
  [System.IO.File]::WriteAllText($taskMusicOverlayPath,$taskMusicStub,[System.Text.UTF8Encoding]::new($false))
  $taskReplacements[$taskMusicSourcePath]=$taskMusicOverlayPath
}
[System.IO.File]::WriteAllText($taskManifestPath,(@{Replace=$taskReplacements}|ConvertTo-Json -Depth 4),[System.Text.UTF8Encoding]::new($false))
$env:GOCACHE=Join-Path $taskRoot 'outputs/go-cache'
Push-Location (Join-Path $taskRoot 'backend')
try {
  & $GoExecutable build -overlay $taskManifestPath -o (Join-Path $taskOutput 'api.exe') .
  if($LASTEXITCODE -ne 0){throw 'Local animation API build failed'}
} finally {Pop-Location}
