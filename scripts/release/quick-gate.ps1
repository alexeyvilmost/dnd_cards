param(
  [switch]$Full,
  [string]$NodeExecutable = 'node',
  [string]$GoExecutable = 'go'
)

$ErrorActionPreference = 'Stop'
$gateStartedAt = Get-Date
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$frontendRoot = Join-Path $repoRoot 'frontend'
$backendRoot = Join-Path $repoRoot 'backend'

function Resolve-TaskExecutable {
  param(
    [Parameter(Mandatory = $true)][string]$Requested,
    [Parameter(Mandatory = $true)][string[]]$Fallbacks,
    [Parameter(Mandatory = $true)][string]$DisplayName
  )

  if (Test-Path -LiteralPath $Requested -PathType Leaf) {
    return (Resolve-Path -LiteralPath $Requested).Path
  }

  $command = Get-Command $Requested -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($fallback in $Fallbacks) {
    if ($fallback -and (Test-Path -LiteralPath $fallback -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $fallback).Path
    }
  }

  throw "$DisplayName не найден. Передайте путь через соответствующий параметр скрипта."
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Executable,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = $repoRoot
  )

  Write-Host "`n==> $Label" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & $Executable @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "$Label завершился с кодом $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$nodeFallback = if ($env:USERPROFILE) {
  Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
} else { '' }
$goFallback = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'dnd-cards-dev/tools/go/bin/go.exe'
} else { '' }

$node = Resolve-TaskExecutable -Requested $NodeExecutable -Fallbacks @($nodeFallback) -DisplayName 'Node.js'
$go = Resolve-TaskExecutable -Requested $GoExecutable -Fallbacks @($goFallback) -DisplayName 'Go'

Push-Location $repoRoot
try {
  $changedFiles = @(
    & git diff --name-only --diff-filter=ACMR
    & git diff --cached --name-only --diff-filter=ACMR
    & git ls-files --others --exclude-standard
  )

  & git rev-parse --verify --quiet origin/main *> $null
  if ($LASTEXITCODE -eq 0) {
    $changedFiles += & git diff --name-only --diff-filter=ACMR origin/main...HEAD
  }
} finally {
  Pop-Location
}
$changedFiles = @($changedFiles | Where-Object { $_ } | Sort-Object -Unique)

$frontendChanged = $Full -or [bool]($changedFiles | Where-Object { $_ -like 'frontend/*' } | Select-Object -First 1)
$backendChanged = $Full -or [bool]($changedFiles | Where-Object { $_ -like 'backend/*' } | Select-Object -First 1)
$workerChanged = $Full -or [bool]($changedFiles | Where-Object { $_ -like 'frontend/worker/*' } | Select-Object -First 1)

Write-Host "Режим: $(if ($Full) { 'полный' } else { 'быстрый' })"
Write-Host "Изменённых файлов: $($changedFiles.Count)"

Invoke-Checked -Label 'Проверка пробелов и конфликт-маркеров в diff' -Executable 'git' -ArgumentList @('diff', '--check')
Invoke-Checked -Label 'Проверка staged diff' -Executable 'git' -ArgumentList @('diff', '--cached', '--check')
Invoke-Checked -Label 'Запрет database dumps в Git' -Executable $node -ArgumentList @('scripts/security/check-no-database-dumps.mjs')
$credentialArguments = @('scripts/security/check-no-known-credentials.mjs')
if (-not $Full) { $credentialArguments += '--changed' }
Invoke-Checked -Label 'Запрет известных секретов и авторегистрации' -Executable $node -ArgumentList $credentialArguments

if ($backendChanged) {
  $previousGoCache = $env:GOCACHE
  $env:GOCACHE = Join-Path $repoRoot 'outputs/release-gate/go-cache'
  New-Item -ItemType Directory -Path $env:GOCACHE -Force | Out-Null
  try {
    Invoke-Checked -Label 'Backend tests' -Executable $go -ArgumentList @('test', './...', '-count=1') -WorkingDirectory $backendRoot
    if ($Full) {
      Invoke-Checked -Label 'Backend vet' -Executable $go -ArgumentList @('vet', './...') -WorkingDirectory $backendRoot
    }
  } finally {
    if ($null -eq $previousGoCache) { Remove-Item Env:GOCACHE -ErrorAction SilentlyContinue } else { $env:GOCACHE = $previousGoCache }
  }
} else {
  Write-Host "`n-- Backend не менялся: Go-проверки пропущены."
}

if ($frontendChanged) {
  $vitest = 'node_modules/vitest/vitest.mjs'
  $eslint = 'node_modules/eslint/bin/eslint.js'

  if ($Full) {
    Invoke-Checked -Label 'Полный frontend Vitest' -Executable $node -ArgumentList @($vitest, 'run', '--reporter=dot') -WorkingDirectory $frontendRoot
    Invoke-Checked -Label 'Rules-core coverage' -Executable $node -ArgumentList @($vitest, 'run', '--config', 'vitest.rules-core.config.ts', '--reporter=dot') -WorkingDirectory $frontendRoot
    Invoke-Checked -Label 'Rules primitives coverage' -Executable $node -ArgumentList @($vitest, 'run', '--config', 'vitest.rules-primitives.config.ts', '--coverage', '--reporter=dot') -WorkingDirectory $frontendRoot
    Invoke-Checked -Label 'Полный frontend lint' -Executable $node -ArgumentList @($eslint, '.', '--ext', 'ts,tsx', '--report-unused-disable-directives', '--max-warnings', '0') -WorkingDirectory $frontendRoot
  } else {
    $changedTests = @(
      $changedFiles |
        Where-Object { $_ -match '^frontend/.+\.test\.tsx?$' } |
        ForEach-Object { $_.Substring('frontend/'.Length) }
    )
    $focusedTests = @(
      'src/character/rules/resolveCharacterRules.test.ts'
      'src/solo-combat/soloCombat.engine.integration.test.ts'
      'src/components/CombatHotbar.test.ts'
    )
    $testFiles = @($focusedTests + $changedTests | Sort-Object -Unique)
    $testArguments = @($vitest, 'run') + $testFiles + @('--reporter=dot', '--passWithNoTests')
    Invoke-Checked -Label "Целевой Vitest ($($testFiles.Count) файлов)" -Executable $node -ArgumentList $testArguments -WorkingDirectory $frontendRoot

    $changedTypeScript = @(
      $changedFiles |
        Where-Object { $_ -match '^frontend/.+\.tsx?$' } |
        ForEach-Object { $_.Substring('frontend/'.Length) }
    )
    if ($changedTypeScript.Count -gt 0) {
      $lintArguments = @($eslint) + $changedTypeScript + @('--report-unused-disable-directives', '--max-warnings', '0')
      Invoke-Checked -Label "Lint изменённых TS/TSX ($($changedTypeScript.Count) файлов)" -Executable $node -ArgumentList $lintArguments -WorkingDirectory $frontendRoot
    }
  }

  Invoke-Checked -Label 'Проверка DiceBox assets' -Executable $node -ArgumentList @('scripts/check-dice-box-assets.mjs') -WorkingDirectory $frontendRoot
  Invoke-Checked -Label 'TypeScript production typecheck' -Executable $node -ArgumentList @('node_modules/typescript/bin/tsc') -WorkingDirectory $frontendRoot
  Invoke-Checked -Label 'Production frontend build' -Executable $node -ArgumentList @('node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.ts') -WorkingDirectory $frontendRoot
  Invoke-Checked -Label 'Проверка DiceBox assets в dist' -Executable $node -ArgumentList @('scripts/check-dice-box-assets.mjs', '--dist') -WorkingDirectory $frontendRoot

  if ($workerChanged) {
    Invoke-Checked -Label 'Rules worker build' -Executable $node -ArgumentList @('worker/build.mjs') -WorkingDirectory $frontendRoot
    Invoke-Checked -Label 'Rules worker tests' -Executable $node -ArgumentList @('--test', 'worker/server.test.mjs', 'worker/replay.test.mjs') -WorkingDirectory $frontendRoot
  }

  if ($Full) {
    $previousCi = $env:CI
    $env:CI = '1'
    try {
      Invoke-Checked -Label 'Полный локальный Playwright' -Executable $node -ArgumentList @('node_modules/@playwright/test/cli.js', 'test', '--reporter=line') -WorkingDirectory $frontendRoot
    } finally {
      if ($null -eq $previousCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue } else { $env:CI = $previousCi }
    }
  }
} else {
  Write-Host "`n-- Frontend не менялся: frontend-проверки пропущены."
}

$elapsed = (Get-Date) - $gateStartedAt
Write-Host "`nРелиз-гейт пройден за $([math]::Round($elapsed.TotalSeconds, 1)) с." -ForegroundColor Green
if (-not $Full) {
  Write-Host 'Полный регресс доступен через scripts/release/quick-gate.ps1 -Full.'
}
