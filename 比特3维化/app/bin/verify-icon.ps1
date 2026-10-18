<#
  Verify the icon actually embedded in the built exe matches electron\icon.ico.

  Not eyeballing: extract the exe's associated icon and compare it pixel-by-pixel
  against the 32px frame of the source .ico, then report three sample points.
#>

param(
  [string]$Root = '',
  [string]$Exe = '',
  [string]$Ico = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Fail($msg) { Write-Host "!! $msg" -ForegroundColor Red; exit 1 }

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -Path $Root).Path
if ([string]::IsNullOrWhiteSpace($Ico)) { $Ico = Join-Path $Root 'electron\icon.ico' }
if ([string]::IsNullOrWhiteSpace($Exe)) { $Exe = Join-Path $Root 'release\win-unpacked\BT3D Box.exe' }

if (-not (Test-Path -LiteralPath $Ico)) { Fail "missing $Ico (run bin\make-icon.ps1)" }
if (-not (Test-Path -LiteralPath $Exe)) { Fail "missing $Exe (build first)" }

$srcIcon = New-Object System.Drawing.Icon($Ico, 32, 32)
$srcBmp = $srcIcon.ToBitmap()
$exeIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($Exe)
$exeBmp = $exeIcon.ToBitmap()

Write-Host "source-ico-frame=$($srcBmp.Width)x$($srcBmp.Height)  extracted=$($exeBmp.Width)x$($exeBmp.Height)"

$w = [Math]::Min($srcBmp.Width, $exeBmp.Width)
$h = [Math]::Min($srcBmp.Height, $exeBmp.Height)
$same = 0
$total = $w * $h
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    if ($srcBmp.GetPixel($x, $y).ToArgb() -eq $exeBmp.GetPixel($x, $y).ToArgb()) { $same += 1 }
  }
}
$pct = [math]::Round(100 * $same / $total, 2)
foreach ($pt in @(@(2, 2), @(16, 16), @(29, 29))) {
  Write-Host ("  sample({0},{1}) src=#{2:X6} exe=#{3:X6}" -f $pt[0], $pt[1], ($srcBmp.GetPixel($pt[0], $pt[1]).ToArgb() -band 0xFFFFFF), ($exeBmp.GetPixel($pt[0], $pt[1]).ToArgb() -band 0xFFFFFF))
}

$srcBmp.Dispose(); $srcIcon.Dispose(); $exeBmp.Dispose(); $exeIcon.Dispose()

Write-Host "pixel-match=$pct% ($same/$total)"
if ($pct -lt 99) { Fail "exe icon differs from $Ico (match $pct%)" }
Write-Host '==> icon verified'
