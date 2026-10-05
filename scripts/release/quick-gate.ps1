param(
  [switch]$Full,
  [switch]$LegacyEntityTests,
  [string]$LegacySuite = '',
  [string]$BaseCommit = '',
  [string]$CandidateCommit = 'HEAD',
  [string]$NodeExecutable = 'node',
  [string]$GoExecutable = '',
  [string]$PostgresBin = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ($LegacyEntityTests -and -not $LegacySuite) {
  throw 'Укажите явный -LegacySuite из tests/suites.json. Общий флаг не выбирает исторические проверки автоматически.'
}
if ($Full -and $LegacySuite) { throw 'Выберите расширенный набор либо один исторический набор.' }
$node = Get-Command $NodeExecutable -ErrorAction SilentlyContinue
if ($node) { $nodePath = $node.Source }
elseif (Test-Path -LiteralPath $NodeExecutable -PathType Leaf) { $nodePath = (Resolve-Path -LiteralPath $NodeExecutable).Path }
else {
  $fallback = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  if (-not (Test-Path -LiteralPath $fallback -PathType Leaf)) { throw 'Node.js не найден; укажите -NodeExecutable.' }
  $nodePath = $fallback
}
$suite = if ($LegacySuite) { 'legacy-manual' } elseif ($Full) { 'extended' } else { 'core' }
$arguments = @((Join-Path $repoRoot 'scripts/testing/run.mjs'), '--suite', $suite, '--candidate', $CandidateCommit)
if ($BaseCommit) { $arguments += @('--base', $BaseCommit) }
if ($LegacySuite) { $arguments += @('--select', $LegacySuite) }
if ($GoExecutable) {
  $go = Get-Command $GoExecutable -ErrorAction SilentlyContinue
  $arguments += @('--go', $(if ($go) { $go.Source } else { $GoExecutable }))
}
if ($PostgresBin) { $arguments += @('--pg-bin', $PostgresBin) }
Push-Location $repoRoot
try {
  & $nodePath @arguments
  if ($LASTEXITCODE -ne 0) { throw "Набор $suite завершился ошибкой. Отчёт указан выше." }
} finally { Pop-Location }
