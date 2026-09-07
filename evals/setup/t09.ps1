param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'paint.png'
  if (Test-Path $f) { Remove-Item $f -Force }
  Get-Process -Name 'mspaint' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $checks += (Add-Check 'out dir prepared, no stale png, no stale paint' (-not (Test-Path $f)) $dir)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
