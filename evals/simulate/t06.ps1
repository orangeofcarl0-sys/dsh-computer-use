param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (New-TaskDir 'out') 'pasted.txt'
  [IO.File]::WriteAllText($f, "S4-CLIP-6f3a9b payload line`r`n", [Text.Encoding]::ASCII)
  Out-Finish -Ok $true -Checks @((Add-Check 'pasted.txt written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
