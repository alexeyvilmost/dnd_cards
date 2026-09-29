param(
    [ValidateRange(1024, 65535)][int]$Port = 4317,
    [string]$DataDirectory,
    [ValidateSet('browser', 'api')][string]$Workflow = 'api',
    [ValidateRange(1, 2)][int]$Concurrency = 2,
    [string]$DownloadDirectory,
    [switch]$Foreground,
    [switch]$Open
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverFile = Join-Path $projectRoot 'scripts/audio/workbench/server.mjs'
if (-not $DataDirectory) { $DataDirectory = Join-Path $projectRoot 'outputs/audio-workbench' }
$dataPath = [IO.Path]::GetFullPath($DataDirectory)
if ($DownloadDirectory) {
    if ($DownloadDirectory -notmatch '^(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+)') {
        throw '-DownloadDirectory должен содержать абсолютный путь к существующей папке.'
    }
    if (-not (Test-Path -LiteralPath $DownloadDirectory -PathType Container)) {
        throw "Папка скачивания не существует: $DownloadDirectory"
    }
    $downloadPath = (Resolve-Path -LiteralPath $DownloadDirectory).ProviderPath
} else {
    $downloadPath = Join-Path $dataPath 'downloads'
    New-Item -ItemType Directory -Force -Path $downloadPath | Out-Null
}
$nodePath = (Get-Command node -ErrorAction Stop).Source
$galleryUrl = "http://127.0.0.1:$Port"

$existing = $null
try { $existing = Invoke-RestMethod -Uri "$galleryUrl/api/state" -TimeoutSec 2 } catch { }
if ($existing) {
    if ($existing.app -ne 'dnd-audio-workbench') {
        throw "Порт $Port занят другим приложением. Укажите -Port с другим номером."
    }
    $existingConcurrency = if ($null -eq $existing.concurrency) { 1 } else { [int]$existing.concurrency }
    if ($existing.workflow -ne $Workflow -or $existing.dataDir -ne $dataPath -or $existing.downloadDir -ne $downloadPath -or $existingConcurrency -ne $Concurrency) {
        throw "На порту $Port уже работает галерея с другими параметрами. Остановите её перед изменением режима, каталогов или числа параллельных запросов либо укажите другой -Port и отдельную -DataDirectory."
    }
    Write-Output "Галерея уже работает ($Workflow): $galleryUrl"
    if ($Open) { Start-Process $galleryUrl }
    exit 0
}

New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
if ($Foreground) {
    if ($Open) { Start-Process $galleryUrl }
    & $nodePath $serverFile --port $Port --data-dir $dataPath --workflow $Workflow --download-dir $downloadPath --concurrency $Concurrency
    exit $LASTEXITCODE
}

$stdoutPath = Join-Path $dataPath 'server.stdout.log'
$stderrPath = Join-Path $dataPath 'server.stderr.log'
$arguments = @(('"' + $serverFile + '"'), '--port', "$Port", '--data-dir', ('"' + $dataPath + '"'), '--workflow', $Workflow, '--download-dir', ('"' + $downloadPath + '"'), '--concurrency', "$Concurrency")
$process = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Set-Content -LiteralPath (Join-Path $dataPath 'server.pid') -Value $process.Id -Encoding ascii

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw "Не удалось запустить галерею. Диагностика: $stderrPath" }
    try {
        $state = Invoke-RestMethod -Uri "$galleryUrl/api/state" -TimeoutSec 1
        if ($state.app -eq 'dnd-audio-workbench') {
            Write-Output "Галерея: $galleryUrl"
            Write-Output "Режим: $Workflow"
            Write-Output "Параллельных API-запросов: $Concurrency"
            Write-Output "Записи и выбор: $dataPath"
            Write-Output "Папка для импорта: $downloadPath"
            if ($Open) { Start-Process $galleryUrl }
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 200
    $process.Refresh()
}
throw "Сервер ещё не ответил. Диагностика: $stderrPath"
