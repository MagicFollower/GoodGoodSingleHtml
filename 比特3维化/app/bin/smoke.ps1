<#
  Smoke test the packaged app without watching a window.

  Launches win-unpacked\<Name>.exe with --selftest, waits for it to exit, then
  asserts the markers the main process prints. The selftest branch does real work:
  vendor hash check, ChaCha20 anchors, a 300,000-byte encode/decode round trip,
  a tamper case, plus renderer-side reads (theme parity, grid breakpoints, min size).
#>

param(
  [string]$Root = '',
  [string]$Exe = '',
  [int]$TimeoutSec = 150
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "!! $msg" -ForegroundColor Red; exit 1 }

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -Path $Root).Path

if ([string]::IsNullOrWhiteSpace($Exe)) {
  $Exe = Join-Path $Root 'release\win-unpacked\BT3D Box.exe'
}
if (-not (Test-Path -LiteralPath $Exe)) { Fail "no such exe: $Exe (build with -Target dir or all first)" }

$out = Join-Path $Root 'smoke-out.txt'
$err = Join-Path $Root 'smoke-err.txt'
foreach ($f in @($out, $err)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }

$prefix = $Root.TrimEnd('\') + '\'
$before = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
}).Count

$p = Start-Process -FilePath $Exe -ArgumentList '--selftest' -PassThru `
  -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300; $p.Refresh() }
if (-not $p.HasExited) {
  try { $p.Kill() } catch { }
  Fail "selftest did not finish within $TimeoutSec s"
}
# Start-Process -PassThru 的对象只有显式 WaitForExit() 之后才填 ExitCode，
# 光靠 HasExited 轮询会读到 null，判据就会把成功报成失败。
$p.WaitForExit()
$exitCode = $p.ExitCode
if ($null -eq $exitCode) { $exitCode = 0 }

$lines = @()
if (Test-Path -LiteralPath $out) { $lines = @(Get-Content -LiteralPath $out -Encoding UTF8) }
$joined = $lines -join "`n"

$fail = @($lines | Where-Object { $_ -like 'SELFTEST-FAIL*' -or $_ -like 'SELF FAIL*' -or $_ -like '*THROW*' })
$done = @($lines | Where-Object { $_ -like 'SELFTEST done*' })
$shown = @($lines | Where-Object { $_ -like 'window-shown*' })
$ok = @($lines | Where-Object { $_ -like 'SELF ok*' }).Count

$after = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
}).Count

foreach ($l in $lines) { Write-Host "  $l" }
if ($err -and (Test-Path -LiteralPath $err)) {
  $rawErr = Get-Content -LiteralPath $err -Raw -Encoding UTF8
  if ($null -ne $rawErr -and $rawErr.Trim().Length -gt 0) {
    $errTxt = $rawErr.Trim()
    Write-Host "  [stderr] $($errTxt.Substring(0, [Math]::Min(400, $errTxt.Length)))"
  }
}

Write-Host "exitcode=$exitCode ok-checks=$ok failed=$($fail.Count) processes-before=$before after=$after"
Write-Host "markers: window-shown=$($shown.Count) done-line=$($done.Count)"

if ($shown.Count -lt 1) { Fail 'missing window-shown marker (renderer never painted from file://)' }
if ($done.Count -lt 1) { Fail 'missing SELFTEST done marker (selftest never completed)' }
if ($fail.Count -gt 0) { Fail "$($fail.Count) selftest assertions failed" }
if ($exitCode -ne 0) { Fail "selftest exited with $exitCode" }
if ($after -ne 0) { Fail "$after project processes still alive after smoke" }

Write-Host '==> smoke pass'
