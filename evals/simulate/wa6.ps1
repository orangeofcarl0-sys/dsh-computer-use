param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (New-TaskDir 'Desktop') 'numdays.txt'
  [IO.File]::WriteAllText($f, "230 days`r`n", [Text.Encoding]::ASCII)
  Out-Finish -Ok $true -Checks @((Add-Check 'numdays.txt written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
