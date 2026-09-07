param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (New-TaskDir 'saveas') 'out-ansi.txt'
  [IO.File]::WriteAllText($f, "S4-T05 ANSI check.`r`n", [Text.Encoding]::Default)
  Out-Finish -Ok $true -Checks @((Add-Check 'ANSI file written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
