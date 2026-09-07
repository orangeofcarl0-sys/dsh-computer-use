param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $f = Join-Path (Get-TaskDir) 'Desktop\numdays.txt'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'numdays.txt exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'numdays.txt exists' $true $f)
  $norm = ([IO.File]::ReadAllText($f)) -replace "`r`n", "`n"
  $t = $norm.Trim()
  $hasNum = ($t -match '(?<!\d)230(?!\d)')
  # U+5929 built from char code: PS1 must stay ASCII-only (PS 5.1 ANSI parsing)
  $tian = [string][char]0x5929
  $hasUnit = ($t -match 'days') -or ($t.Contains($tian))
  $checks += (Add-Check 'contains 230' $hasNum ('read=' + $t))
  $checks += (Add-Check 'contains unit (days/tian)' $hasUnit '')
  Out-Finish -Ok ($hasNum -and $hasUnit) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
