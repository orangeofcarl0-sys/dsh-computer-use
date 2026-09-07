param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  Add-Type -AssemblyName System.Drawing
  $f = Join-Path (Get-TaskDir) 'out\paint.png'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $f)
  $bmp = New-Object System.Drawing.Bitmap $f
  $c1 = ($bmp.Width -eq 200 -and $bmp.Height -eq 150)
  $checks += (Add-Check 'size == 200x150' $c1 ('actual=' + $bmp.Width + 'x' + $bmp.Height))
  $red = 0; $total = $bmp.Width * $bmp.Height
  for ($y = 0; $y -lt $bmp.Height; $y += 2) {
    for ($x = 0; $x -lt $bmp.Width; $x += 2) {
      $px = $bmp.GetPixel($x, $y)
      if ($px.R -gt 240 -and $px.G -lt 15 -and $px.B -lt 15) { $red++ }
    }
  }
  $sampled = [Math]::Ceiling($bmp.Width / 2.0) * [Math]::Ceiling($bmp.Height / 2.0)
  $ratio = $red / $sampled
  $c2 = ($ratio -ge 0.9)
  $checks += (Add-Check 'red pixels >= 90%' $c2 ('ratio=' + [Math]::Round($ratio, 3)))
  $bmp.Dispose()
  Out-Finish -Ok ($c1 -and $c2) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
