param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'swap'
  $a = Join-Path $dir 'a.txt'
  $b = Join-Path $dir 'b.txt'
  [IO.File]::WriteAllText($a, 'AAA-content-original-a', [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText($b, 'BBB-content-original-b', [Text.Encoding]::ASCII)
  $checks += (Add-Check 'a.txt prepared' (Test-Path $a) $a)
  $checks += (Add-Check 'b.txt prepared' (Test-Path $b) $b)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
