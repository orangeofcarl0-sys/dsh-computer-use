param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'hello.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  $checks += (Add-Check 'out dir prepared, no stale file' (-not (Test-Path $f)) $dir)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
