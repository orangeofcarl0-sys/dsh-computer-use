param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $img = New-TaskDir 'img'
  New-TaskDir 'Downloads'
  $f = Join-Path $img 'circle-src.png'
  New-Png -Path $f -W 240 -H 160 -R 40 -G 80 -B 220
  $stale = Join-Path (Get-TaskDir) 'Downloads\circle.png'
  if (Test-Path $stale) { Remove-Item $stale -Force }
  Get-Process -Name 'mspaint' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $checks += (Add-Check 'circle-src.png prepared' ((Test-Path $f) -and (-not (Test-Path $stale))) $f)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
