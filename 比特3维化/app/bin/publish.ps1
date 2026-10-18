<#
  Publish the two installers into a versioned folder on a share.

  Gate: the exe's FileVersion must equal package.json's version. Without it a stale
  release/ folder can be copied out under a fresh version number - that happened on
  another project and this check is what caught it.

  ASCII-only: Windows PowerShell 5.1 decodes BOM-less files as ANSI.
#>

param(
  [string]$Root = '',
  [string]$Share = '',
  [int]$KeepVersions = 2,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "!! $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "    $msg" }

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -Path $Root).Path
$pkg = Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
$name = $pkg.productName
if ([string]::IsNullOrWhiteSpace($name)) { $name = $pkg.name }

$release = Join-Path $Root 'release'
if (-not (Test-Path -LiteralPath $release)) { Fail "no release dir under $Root" }

$exes = @(Get-ChildItem -LiteralPath $release -Filter '*.exe' -File | Where-Object { $_.Name -like '*_setup*' -or $_.Name -like '*_portable*' })
if ($exes.Count -eq 0) { Fail 'no *_setup.exe / *_portable.exe in release - build first' }

Write-Host "==> gate: package.json version = $version"
foreach ($f in $exes) {
  $fv = $f.VersionInfo.FileVersion
  if ($fv -ne $version) {
    Fail "$($f.Name) has FileVersion '$fv' but package.json says '$version' - rebuild before publishing"
  }
  Info ("ok  {0}  FileVersion={1}  {2:N0} bytes" -f $f.Name, $fv, $f.Length)
}

if ([string]::IsNullOrWhiteSpace($Share)) {
  Write-Host '==> no -Share given: nothing to copy. Re-run with -Share <path> (or -DryRun against a local dir).'
  exit 0
}

$target = Join-Path (Join-Path $Share $name) $version
Write-Host "==> target: $target"
if ($DryRun) { Write-Host '    (DryRun: no writes performed)'; exit 0 }

New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($f in $exes) {
  Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $target $f.Name) -Force
  $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
  Set-Content -LiteralPath (Join-Path $target "$($f.Name).sha256") -Value "$hash  $($f.Name)" -Encoding ascii
  Info ("copied {0}  + .sha256" -f $f.Name)
}

$parent = Split-Path -Parent $target
$versions = @(Get-ChildItem -LiteralPath $parent -Directory | Sort-Object Name)
$retained = 0
if ($KeepVersions -gt 0 -and $versions.Count -gt $KeepVersions) {
  $stale = $versions[0..($versions.Count - $KeepVersions - 1)]
  foreach ($d in $stale) {
    Remove-Item -LiteralPath $d.FullName -Recurse -Force
    Info ("pruned {0}" -f $d.Name)
  }
  $retained = $KeepVersions
} else {
  $retained = $versions.Count
}
Write-Host "==> published to $target ; retained-versions=$retained"
