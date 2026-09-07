param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $dir = New-TaskDir 'files'
  $old = Join-Path $dir 'report-q7.txt'
  $new = Join-Path $dir 'report-q7-final.txt'
  [IO.File]::WriteAllText($old, 'Q7 report body 12345', [Text.Encoding]::ASCII)
  Move-Item -LiteralPath $old -Destination $new
  Out-Finish -Ok $true -Checks @((Add-Check 'renamed' (Test-Path $new) $new)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
