param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'docs'
  $f = Join-Path $dir 'invoice.txt'
  $content = "alpha is the first word`r`nalpha report alpha summary`r`nend of alpha memo"
  [IO.File]::WriteAllText($f, $content, [Text.Encoding]::ASCII)
  $checks += (Add-Check 'invoice.txt prepared' (Test-Path $f) $f)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
