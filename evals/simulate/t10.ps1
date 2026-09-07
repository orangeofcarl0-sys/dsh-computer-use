param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $dir = New-TaskDir 'swap'
  [IO.File]::WriteAllText((Join-Path $dir 'a.txt'), 'BBB-content-original-b', [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText((Join-Path $dir 'b.txt'), 'AAA-content-original-a', [Text.Encoding]::ASCII)
  Out-Finish -Ok $true -Checks @() -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
