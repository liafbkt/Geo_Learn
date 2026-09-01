param(
  [Parameter(Mandatory = $false)]
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$allowedUpdater = 'https://github.com/liafbkt/Geo_Learn/releases/latest/download/latest.json'
$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$violations = [System.Collections.Generic.List[string]]::new()

function Add-RemoteViolations {
  param([string]$Path, [string]$Text)
  $pattern = 'https?://[^\s"''<>)\]]+'
  foreach ($match in [regex]::Matches($Text, $pattern)) {
    $url = $match.Value.TrimEnd(';', ',', '.')
    if ($url -ne $allowedUpdater) {
      $violations.Add("$Path -> $url")
    }
  }
}

$distRoot = Join-Path $resolvedRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'index.html'))) {
  throw 'Offline scan requires dist/index.html.'
}

Get-ChildItem -LiteralPath $distRoot -Recurse -File |
  Where-Object { $_.Extension -in @('.html', '.css') } |
  ForEach-Object {
    Add-RemoteViolations -Path $_.FullName -Text (Get-Content -LiteralPath $_.FullName -Raw)
  }

$sourceRoot = Join-Path $resolvedRoot 'src'
if (Test-Path -LiteralPath $sourceRoot) {
  Get-ChildItem -LiteralPath $sourceRoot -Recurse -File |
    Where-Object {
      $_.Extension -in @('.ts', '.tsx', '.js', '.mjs') -and
      $_.FullName -notmatch '[\\/]_provenance[\\/]' -and
      $_.Name -notmatch '\.(test|spec)\.' -and
      $_.FullName -notmatch '[\\/]e2e[\\/]'
    } |
    ForEach-Object {
      [string]$text = Get-Content -LiteralPath $_.FullName -Raw
      $networkCalls = [regex]::Matches(
        $text,
        '\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\([^\r\n;]*https?://[^\r\n;]*'
      )
      foreach ($call in $networkCalls) {
        Add-RemoteViolations -Path $_.FullName -Text $call.Value
      }
    }
}

$tauriConfigPath = Join-Path $resolvedRoot 'src-tauri\tauri.conf.json'
if (-not (Test-Path -LiteralPath $tauriConfigPath)) {
  throw 'Offline scan requires src-tauri/tauri.conf.json.'
}
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$endpoints = @($tauriConfig.plugins.updater.endpoints)
foreach ($endpoint in $endpoints) {
  if ($endpoint -ne $allowedUpdater) {
    $violations.Add("$tauriConfigPath -> updater endpoint $endpoint")
  }
}

if ($violations.Count -gt 0) {
  Write-Error ("Offline scan rejected runtime network references:`n" + (($violations | Sort-Object -Unique) -join "`n"))
  exit 1
}

Write-Output 'Offline scan passed.'
