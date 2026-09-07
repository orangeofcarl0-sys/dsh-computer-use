param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = Get-TaskDir
  $a = Join-Path $dir 'swap\a.txt'
  $b = Join-Path $dir 'swap\b.txt'
  $okA = (Test-Path $a); $okB = (Test-Path $b)
  if (-not $okA) { $checks += (Add-Check 'a.txt exists' $false $a) } else { $checks += (Add-Check 'a.txt exists' $true '') }
  if (-not $okB) { $checks += (Add-Check 'b.txt exists' $false $b) } else { $checks += (Add-Check 'b.txt exists' $true '') }
  $cA = $false; $cB = $false; $rA = ''; $rB = ''
  if ($okA) { $rA = (([IO.File]::ReadAllText($a)) -replace "`r`n", "`n").Trim() }
  if ($okB) { $rB = (([IO.File]::ReadAllText($b)) -replace "`r`n", "`n").Trim() }
  $cA = ($rA -eq 'BBB-content-original-b')
  $cB = ($rB -eq 'AAA-content-original-a')
  $checks += (Add-Check 'a.txt == b original' $cA ('a=' + $rA))
  $checks += (Add-Check 'b.txt == a original' $cB ('b=' + $rB))
  Out-Finish -Ok ($cA -and $cB) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
