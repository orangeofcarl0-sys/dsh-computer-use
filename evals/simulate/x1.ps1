param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $target = Join-Path (New-TaskDir 'target') 'deleg.txt'
  $content = "HELLO-DELEG"
  [IO.File]::WriteAllText($target, $content, [Text.Encoding]::ASCII)
  Out-Finish -Ok $true -Checks @((Add-Check 'success state written' (Test-Path $target) $target)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
