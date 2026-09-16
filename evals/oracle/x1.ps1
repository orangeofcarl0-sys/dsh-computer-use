param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $f = Join-Path (Get-TaskDir) 'target\deleg.txt'
  if (-not (Test-Path $f)) { $checks += (Add-Check 'file exists' $false $f); Out-Finish -Ok $false -Checks $checks }
  $checks += (Add-Check 'file exists' $true $f)
  $norm = ([IO.File]::ReadAllText($f)) -replace "`r`n", "`n"
  $ok = ($norm.Trim() -eq 'HELLO-DELEG')
  $checks += (Add-Check 'content == HELLO-DELEG' $ok ('read=' + $norm.Trim()))
  Out-Finish -Ok $ok -Checks $checks
} catch { Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message }
