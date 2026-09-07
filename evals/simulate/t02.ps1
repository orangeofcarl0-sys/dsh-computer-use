param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (New-TaskDir 'docs') 'invoice.txt'
  $content = "beta is the first word`r`nbeta report beta summary`r`nend of beta memo"
  [IO.File]::WriteAllText($f, $content, [Text.Encoding]::ASCII)
  Out-Finish -Ok $true -Checks @((Add-Check 'success state written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
