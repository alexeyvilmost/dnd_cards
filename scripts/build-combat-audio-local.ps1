param(
  [string]$GoExecutable='C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe',
  [string]$OutputDirectory='outputs/combat-audio-v2/service'
)
# Isolated preview only. Preserve unrelated guarded migrations as pending and
# use the real migration lock/receipts for the selected sound and music catalog.
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskOutput=Join-Path $taskRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskSourcePath=Join-Path $taskRoot 'backend/migrations/migration.go'
$taskSource=Get-Content -LiteralPath $taskSourcePath -Raw
$taskGuard=@'
var localAudioDatabase bool
	if err := m.db.QueryRow("SELECT current_database()='combat_audio_289_20260929' AND inet_server_addr() IN ('127.0.0.1'::inet,'::1'::inet)").Scan(&localAudioDatabase); err != nil { return err }
	if !localAudioDatabase { return fmt.Errorf("audio preview overlay only accepts its named loopback database") }
	ctx := context.Background()
'@
$taskLoop=@'
for _, migration := range GetAllMigrations() {
		if migration.Version != "286_combat_animation_metadata" && migration.Version != "287_combat_animation_coverage" && migration.Version != "288_force_animation_palette" && migration.Version != "289_selected_combat_audio" && migration.Version != "291_expanded_fantasy_music" {
			if !executedMigrations[migration.Version] { log.Printf("LOCAL PREVIEW: leaving unrelated migration pending: %s", migration.Version) }
			continue
		}
'@
if(-not $taskSource.Contains('ctx := context.Background()') -or -not $taskSource.Contains('for _, migration := range GetAllMigrations() {')) {throw 'Migration source changed; review overlay before rebuilding'}
$taskOverlaySource=$taskSource.Replace('ctx := context.Background()',$taskGuard).Replace('for _, migration := range GetAllMigrations() {',$taskLoop)
$taskOverlayPath=Join-Path $taskOutput 'migration.local.go'
$taskManifestPath=Join-Path $taskOutput 'go-overlay.json'
[System.IO.File]::WriteAllText($taskOverlayPath,$taskOverlaySource,[System.Text.UTF8Encoding]::new($false))
$taskMainPath=Join-Path $taskRoot 'backend/main.go'
$taskMain=Get-Content -LiteralPath $taskMainPath -Raw
if(-not $taskMain.Contains('r.Run(":" + port)')) {throw 'Server listen source changed; review local overlay'}
$taskMainOverlay=Join-Path $taskOutput 'main.local.go'
[System.IO.File]::WriteAllText($taskMainOverlay,$taskMain.Replace('r.Run(":" + port)','r.Run("127.0.0.1:" + port)'),[System.Text.UTF8Encoding]::new($false))
$taskReplacements=@{}
$taskReplacements[$taskSourcePath]=$taskOverlayPath
$taskReplacements[$taskMainPath]=$taskMainOverlay
[System.IO.File]::WriteAllText($taskManifestPath,(@{Replace=$taskReplacements}|ConvertTo-Json -Depth 4),[System.Text.UTF8Encoding]::new($false))
$env:GOCACHE=Join-Path $taskRoot 'outputs/go-cache'
Push-Location (Join-Path $taskRoot 'backend')
try {
  & $GoExecutable build -overlay $taskManifestPath -o (Join-Path $taskOutput 'api.exe') .
  if($LASTEXITCODE -ne 0){throw 'Local audio API build failed'}
} finally {Pop-Location}
