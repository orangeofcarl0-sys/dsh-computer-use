param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $f = Join-Path (Get-TaskDir) 'docs\invoice.txt'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $f)
  $norm = ([IO.File]::ReadAllText($f)) -replace "`r`n", "`n"
  $alpha = [regex]::Matches($norm, 'alpha', 'IgnoreCase').Count
  $beta = [regex]::Matches($norm, 'beta', 'IgnoreCase').Count
  $c1 = ($alpha -eq 0)
  $c2 = ($beta -eq 4)
  $c3 = $norm.Contains('beta is the first word')
  $checks += (Add-Check 'alpha remaining == 0' $c1 ("count=" + $alpha))
  $checks += (Add-Check 'beta total == 4' $c2 ("count=" + $beta))
  $checks += (Add-Check 'first line replaced' $c3 '')
  Out-Finish -Ok ($c1 -and $c2 -and $c3) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
