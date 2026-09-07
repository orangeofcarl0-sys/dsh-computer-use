param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $pics = New-TaskDir 'Pictures'
  New-Png -Path (Join-Path $pics 'alpha-001.png') -W 64 -H 48 -R 200 -G 10 -B 10
  New-Png -Path (Join-Path $pics 'beta-002.png') -W 64 -H 48 -R 10 -G 200 -B 10
  New-Png -Path (Join-Path $pics 'gamma-003.png') -W 64 -H 48 -R 10 -G 10 -B 200
  New-Png -Path (Join-Path $pics 'delta-004.png') -W 64 -H 48 -R 200 -G 200 -B 10
  [IO.File]::WriteAllText((Join-Path $pics 'notes.txt'), 'decoy notes', [Text.Encoding]::ASCII)
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 64, 48
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 200, 200)); $g.Dispose()
  $bmp.Save((Join-Path $pics 'cover.jpg'), [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bmp.Dispose()
  $stale = Join-Path $pics 'png_files.txt'
  if (Test-Path $stale) { Remove-Item $stale -Force }
  $all = @(Get-ChildItem -LiteralPath $pics -File)
  $checks += (Add-Check 'pictures prepared (6 files, no png_files.txt)' ($all.Count -eq 6 -and (-not (Test-Path $stale))) (($all | ForEach-Object { $_.Name }) -join ','))
  Out-Finish -Ok ($all.Count -eq 6) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
