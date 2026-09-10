param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  # pre-stage: calculator already open (removes launch+discovery cost; oracle unchanged)
  $pid2 = Start-Calculator
  $checks += (Add-Check 'calculator opened' ($null -ne $pid2) ('pid=' + $pid2))
  Out-Finish -Ok ($null -ne $pid2) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
