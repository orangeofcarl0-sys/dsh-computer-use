param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (New-TaskDir 'out') 'hello.txt'
  [IO.File]::WriteAllText($f, "S4-T08 hello from run dialog`r`n", [Text.Encoding]::ASCII)
  Out-Finish -Ok $true -Checks @((Add-Check 'hello.txt written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
