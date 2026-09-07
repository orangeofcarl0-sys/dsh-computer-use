param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  Add-Type -AssemblyName System.Drawing
  $f = Join-Path (Get-TaskDir) 'out\resized.png'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $f)
  $bmp = New-Object System.Drawing.Bitmap $f
  $ok = ($bmp.Width -eq 800 -and $bmp.Height -eq 600)
  $checks += (Add-Check 'size == 800x600' $ok ('actual=' + $bmp.Width + 'x' + $bmp.Height))
  $bmp.Dispose()
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
