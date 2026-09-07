param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'files'
  $f = Join-Path $dir 'report-q7.txt'
  [IO.File]::WriteAllText($f, 'Q7 report body 12345', [Text.Encoding]::ASCII)
  $checks += (Add-Check 'report-q7.txt prepared' (Test-Path $f) $f)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
