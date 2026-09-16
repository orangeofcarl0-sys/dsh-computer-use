param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  New-TaskDir 'target' | Out-Null
  $f = Join-Path (Get-TaskDir) 'target\deleg.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  $checks += (Add-Check 'target dir prepared, no stale file' (-not (Test-Path $f)) (Split-Path $f))
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch { Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup' }
