<#
  Stop dev processes started by THIS project only.

  Filter is the executable's image path living under the project dir - never
  `taskkill /IM electron.exe`, which would take down other Electron apps and the editor.
#>

param(
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -Path $Root).Path
$prefix = $Root.TrimEnd('\') + '\'

$killed = 0
$targets = @()
foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
  try {
    $path = $p.Path
  } catch { continue }
  if ([string]::IsNullOrWhiteSpace($path)) { continue }
  if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $targets += $p }
}

foreach ($p in $targets) {
  Write-Host ("killing pid={0} {1}" -f $p.Id, (Split-Path -Leaf $p.Path))
  try { $p.Kill(); $killed += 1 } catch { Write-Host ("  skip: {0}" -f $_.Exception.Message) }
}

Start-Sleep -Milliseconds 400
$remaining = 0
foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
  try { $path = $p.Path } catch { continue }
  if ([string]::IsNullOrWhiteSpace($path)) { continue }
  if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $remaining += 1 }
}

Write-Host "killed=$killed remaining=$remaining"
if ($remaining -ne 0) { Write-Host 'some processes survived; run this script once more' }
