<#
  One-shot Windows Electron build helper (BT3D Box).

  In order: locate node.exe, inject the binary mirrors (pass -NoMirror to pull from
  GitHub instead), npm install, fetch the Electron runtime binary when
  node_modules/electron/dist/electron.exe is missing, build, package, print artifact sizes.

  Kept ASCII-only on purpose: Windows PowerShell 5.1 decodes BOM-less files as ANSI.
#>

param(
  [string]$Root = '',
  [ValidateSet('all', 'portable', 'nsis', 'dir')]
  [string]$Target = 'all',
  [switch]$SkipInstall,
  [switch]$NoMirror,
  [string]$NodeDir = 'C:\Program Files\nodejs',
  [string]$ElectronMirror = 'https://npmmirror.com/mirrors/electron/',
  [string]$BuilderBinariesMirror = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
)

$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "==> $msg" }
function Fail($msg) { Write-Host "!! $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "    $msg" }

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -Path $Root).Path
if (-not (Test-Path (Join-Path $Root 'package.json'))) {
  Fail "no package.json under $Root - pass -Root <project dir>"
}
Step "project root: $Root"

$NodeExe = Join-Path $NodeDir 'node.exe'
if (-not (Test-Path $NodeExe)) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $NodeExe = $cmd.Source; $NodeDir = Split-Path -Parent $cmd.Source }
}
if (-not (Test-Path $NodeExe)) { Fail "node.exe not found (looked in $NodeDir and PATH)" }

$NpmCli = Join-Path $NodeDir 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $NpmCli)) { Fail "npm-cli.js not found at $NpmCli" }

Info ('node: ' + (& $NodeExe -v))
# This shell's PATH may predate the Node install; npm child processes need node resolvable.
$env:Path = $NodeDir + [IO.Path]::PathSeparator + $env:Path

function Invoke-Npm([string[]]$npmArgs) {
  & $NodeExe $NpmCli @npmArgs
  if ($LASTEXITCODE -ne 0) { Fail "npm $($npmArgs -join ' ') exited with $LASTEXITCODE" }
}

if ($NoMirror) {
  Step 'mirror injection skipped (-NoMirror): binaries come from GitHub Releases'
} else {
  # Measured: HEAD https://github.com/electron/electron/releases answers 200, yet
  # electron-builder's GET of the release object times out. HEAD does NOT prove the
  # download works, so mirrors are injected by default and -NoMirror is the opt-out.
  Step 'injecting binary mirrors (override with -NoMirror or by exporting the vars)'
  if (-not $env:ELECTRON_MIRROR) {
    $env:ELECTRON_MIRROR = $ElectronMirror
    Info "ELECTRON_MIRROR = $ElectronMirror"
  }
  if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = $BuilderBinariesMirror
    Info "ELECTRON_BUILDER_BINARIES_MIRROR = $BuilderBinariesMirror"
  }
}

Push-Location $Root
try {
  if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    if ($SkipInstall) { Fail 'node_modules missing but -SkipInstall was passed' }
    Step 'installing dependencies'
    Invoke-Npm @('install', '--no-audit', '--no-fund', '--loglevel=warn')
  }

  # npm install exiting 0 does NOT mean the binary landed: current Electron has no
  # postinstall, the download lives in bin/install-electron.
  $electronExe = Join-Path $Root 'node_modules\electron\dist\electron.exe'
  if (Test-Path $electronExe) {
    Step 'Electron binary present'
  } else {
    Step 'Electron binary missing, fetching it'
    $pkg = Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $pkg.scripts.'ensure-electron') {
      Fail 'package.json has no scripts["ensure-electron"] - add: "ensure-electron": "install-electron"'
    }
    Invoke-Npm @('run', 'ensure-electron')
    if (-not (Test-Path $electronExe)) { Fail 'still missing after ensure-electron' }
  }

  Step "typecheck"
  Invoke-Npm @('run', 'typecheck')

  Step "building and packaging ($Target)"
  if ($Target -eq 'all') {
    Invoke-Npm @('run', 'dist')
  } else {
    Invoke-Npm @('run', 'build')
    Invoke-Npm @('exec', 'electron-builder', '--', '--win', $Target)
  }

  $release = Join-Path $Root 'release'
  if (-not (Test-Path $release)) { Fail 'no release directory was produced' }

  Step 'artifacts'
  Get-ChildItem -Path $release -Recurse -File |
    Where-Object { $_.Extension -in '.exe', '.yml' } |
    Sort-Object Length -Descending |
    ForEach-Object {
      Info ("{0,9} MB  {1}" -f [math]::Round($_.Length / 1MB, 1), $_.FullName.Substring($release.Length + 1))
    }

  $unpacked = Join-Path $release 'win-unpacked'
  if (Test-Path $unpacked) {
    $bytes = (Get-ChildItem -Path $unpacked -Recurse -File | Measure-Object -Property Length -Sum).Sum
    Info ("{0,9} MB  [installed directory] win-unpacked" -f [math]::Round($bytes / 1MB, 1))
  }
}
finally {
  Pop-Location
}

Step 'done'
