param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $img = New-TaskDir 'img'
  New-TaskDir 'out'
  $f = Join-Path $img 'canvas-300x200.png'
  New-Png -Path $f -W 300 -H 200 -R 128 -G 128 -B 128
  $stale = Join-Path (Get-TaskDir) 'out\resized.png'
  if (Test-Path $stale) { Remove-Item $stale -Force }
  Get-Process -Name 'mspaint' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $checks += (Add-Check 'canvas-300x200.png prepared' ((Test-Path $f) -and (-not (Test-Path $stale))) $f)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
