<#
  Pixel monogram .ico generator (System.Drawing only, no ImageMagick/Python).

  The glyph is rasterized once into an 11x11 ink mask, then every frame is drawn as
  solid cells of floor(Size/11) px, so all seven layers are hard-edged with no
  resampling and no antialiasing - that blockiness is the whole point.

  ASCII-only on purpose: Windows PowerShell 5.1 decodes BOM-less files as ANSI.
#>

param(
  [string]$Letter = 'B',
  [string]$Out = '',
  [string]$Bg = '#2f6feb',
  [string]$Fg = '',
  [int]$Grid = 11
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrWhiteSpace($Out)) {
  $Out = Join-Path (Split-Path -Parent $PSScriptRoot) 'electron\icon.ico'
}

if ($Letter.Length -ne 1) { Write-Host "!! -Letter takes exactly one char, got '$Letter'"; exit 1 }
$ch = $Letter.ToUpperInvariant()[0]
if (-not (($ch -ge 'A' -and $ch -le 'Z') -or ($ch -ge '0' -and $ch -le '9'))) {
  Write-Host "!! -Letter must be A-Z or 0-9 (got '$ch'); refusing to draw an empty box"
  exit 1
}

function Parse-HexColor([string]$s) {
  $h = $s.Trim().TrimStart('#')
  if ($h.Length -eq 3) { $h = ($h.ToCharArray() | ForEach-Object { "$_$_" }) -join '' }
  if ($h.Length -ne 6) { throw "bad hex color '$s'" }
  return [uint32](0xFF000000L -bor ([Convert]::ToUInt32($h, 16)))
}

$bgArgb = Parse-HexColor $Bg        # NB: PS variable names are case-insensitive; never name a local like the param

# foreground: explicit, else pick by background relative luminance
if ([string]::IsNullOrWhiteSpace($Fg)) {
  $rB = [int](($bgArgb -shr 16) -band 0xFF)
  $gB = [int](($bgArgb -shr 8) -band 0xFF)
  $bB = [int]($bgArgb -band 0xFF)
  $lum = (0.2126 * $rB + 0.7152 * $gB + 0.0722 * $bB) / 255
  $fgArgb = Parse-HexColor $(if ($lum -lt 0.5) { '#ffffff' } else { '#111111' })
  Write-Host "auto-fg = $(if ($lum -lt 0.5) { '#ffffff' } else { '#111111' }) (bg luminance $([math]::Round($lum,3)))"
} else {
  $fgArgb = Parse-HexColor $Fg
}

# --- 1. rasterize the letter into an 11x11 ink mask -------------------------
$maskBmp = New-Object System.Drawing.Bitmap($Grid, $Grid, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($maskBmp)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
$g.Clear([System.Drawing.Color]::Transparent)
$family = New-Object System.Drawing.FontFamily([System.Drawing.FontFamily]::GenericSansSerif.Name)
$font = New-Object System.Drawing.Font($family, 13.5, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, $Grid, $Grid)
$brush = [System.Drawing.Brushes]::White
$g.DrawString([string]$ch, $font, $brush, $rect, $sf)
$g.Dispose()

$mask = New-Object 'bool[]' ($Grid * $Grid)
for ($y = 0; $y -lt $Grid; $y++) {
  for ($x = 0; $x -lt $Grid; $x++) {
    $px = $maskBmp.GetPixel($x, $y)
    $mask[$y * $Grid + $x] = ($px.A -gt 127)
  }
}
$maskBmp.Dispose()
$inkCells = @($mask | Where-Object { $_ }).Count
if ($inkCells -lt 8) { Write-Host "!! glyph '$ch' rasterized to only $inkCells cells; refusing to emit a blank icon"; exit 1 }
Write-Host "mask '$ch' = $inkCells / $($Grid * $Grid) inked cells"

# --- 2. one pixel rule, shared by the BMP layers and the PNG layer ----------
function New-Frame([int]$size, [bool]$pngLayer) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $cell = [int][math]::Floor($size / $Grid)
  if ($cell -lt 1) { $cell = 1 }
  $gw = $cell * $Grid
  $off = [int][math]::Floor(($size - $gw) / 2)
  $bg = [System.Drawing.Color]::FromArgb([int](($bgArgb -shr 16) -band 0xFF), [int](($bgArgb -shr 8) -band 0xFF), [int]($bgArgb -band 0xFF))
  $fgc = [System.Drawing.Color]::FromArgb([int](($fgArgb -shr 16) -band 0xFF), [int](($fgArgb -shr 8) -band 0xFF), [int]($fgArgb -band 0xFF))
  for ($y = 0; $y -lt $size; $y++) {
    for ($x = 0; $x -lt $size; $x++) {
      $gx = [int][math]::Floor(($x - $off) / $cell)
      $gy = [int][math]::Floor(($y - $off) / $cell)
      $ink = $false
      if ($gx -ge 0 -and $gx -lt $Grid -and $gy -ge 0 -and $gy -lt $Grid) { $ink = $mask[$gy * $Grid + $gx] }
      $bmp.SetPixel($x, $y, $(if ($ink) { $fgc } else { $bg }))
    }
  }
  $bytes = $null
  if ($pngLayer) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
  } else {
    $rect2 = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $data = $bmp.LockBits($rect2, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $raw = New-Object 'byte[]' ($stride * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
    $bmp.UnlockBits($data)
    # bottom-up BGRA DIB body
    $body = New-Object 'byte[]' ($raw.Length)
    for ($y = 0; $y -lt $size; $y++) {
      [Array]::Copy($raw, $y * $stride, $body, ($size - 1 - $y) * $stride, $stride)
    }
    $hdr = New-Object 'byte[]' 40
    $bi = [System.BitConverter]::GetBytes([int32]40); [Array]::Copy($bi, 0, $hdr, 0, 4)
    $bi = [System.BitConverter]::GetBytes([int32]$size); [Array]::Copy($bi, 0, $hdr, 4, 4)
    $bi = [System.BitConverter]::GetBytes([int32]($size * 2)); [Array]::Copy($bi, 0, $hdr, 8, 4)   # biHeight = 2h
    $bi = [System.BitConverter]::GetBytes([int16]1); [Array]::Copy($bi, 0, $hdr, 12, 2)
    $bi = [System.BitConverter]::GetBytes([int16]32); [Array]::Copy($bi, 0, $hdr, 14, 2)
    $andStride = [int][math]::Ceiling($size / 32) * 4
    $and = New-Object 'byte[]' ($andStride * $size)          # all zero = no per-pixel transparency from the mask
    $bytes = New-Object 'byte[]' ($hdr.Length + $body.Length + $and.Length)
    [Array]::Copy($hdr, 0, $bytes, 0, $hdr.Length)
    [Array]::Copy($body, 0, $bytes, $hdr.Length, $body.Length)
    [Array]::Copy($and, 0, $bytes, $hdr.Length + $body.Length, $and.Length)
  }
  $bmp.Dispose()
  return , $bytes
}

$sizes = @(16, 24, 32, 48, 64, 128)
$frames = @()
foreach ($s in $sizes) { $frames += , @($s, (New-Frame $s $false), $false) }
$frames += , @(256, (New-Frame 256 $true), $true)

# --- 3. ICO container -------------------------------------------------------
$ms2 = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms2)
$bw.Write([int16]0); $bw.Write([int16]1); $bw.Write([int16]$frames.Count)
$dataBlob = New-Object System.IO.MemoryStream
foreach ($f in $frames) {
  $s = $f[0]; $payload = $f[1]
  $wByte = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$wByte); $bw.Write([byte]$wByte)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([int16]1); $bw.Write([int16]32)
  $bw.Write([int32]$payload.Length)
  $bw.Write([int32](6 + 16 * $frames.Count + $dataBlob.Length))
  $dataBlob.Write($payload, 0, $payload.Length)
  $cell = [int][math]::Floor($s / $Grid)
  Write-Host ("  layer {0,3}px  cell={1}px  glyph={2}x{3}  {4}" -f $s, $cell, ($cell * $Grid), ($cell * $Grid), $(if ($f[2]) { 'PNG' } else { 'BMP' }))
}
$bw.Write($dataBlob.ToArray())
$ico = $ms2.ToArray()
$bw.Close(); $ms2.Close(); $dataBlob.Close()

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
[System.IO.File]::WriteAllBytes($Out, $ico)

# round-trip: let GDI+ read it back and report the frame it picks
$ic = New-Object System.Drawing.Icon($Out, 32, 32)
Write-Host "icon-loaded size=$($ic.Width)x$($ic.Height)"
$ic.Dispose()
try {
  $bmp2 = [System.Drawing.Bitmap]::FromFile($Out)
  Write-Host "png-decodable=$($bmp2.Width)x$($bmp2.Height)"
  $bmp2.Dispose()
} catch {
  # GDI+ 不保证能直接按文件解 .ico；这条只是附加信息，不算失败
  Write-Host "png-decodable=skipped ($($_.Exception.GetType().Name))"
}
Write-Host "==> wrote $Out ($($ico.Length) bytes, $($frames.Count) layers)"
