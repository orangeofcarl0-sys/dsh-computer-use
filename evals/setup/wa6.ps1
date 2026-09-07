param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $desk = New-TaskDir 'Desktop'
  $f = Join-Path $desk 'numdays.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  # independent recomputation of the gold answer (2024-01-03 .. 2024-08-20)
  $d0 = Get-Date '2024-01-03'
  $d1 = Get-Date '2024-08-20'
  $span = ($d1 - $d0).Days
  $checks += (Add-Check 'gold recheck (days=230)' ($span -eq 230) ('computed=' + $span))
  Out-Finish -Ok ($span -eq 230) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
