param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (Get-TaskDir) 'Documents\secret.txt'
  attrib.exe +H $f | Out-Null
  $attr = (Get-Item -Force $f).Attributes
  Out-Finish -Ok (($attr -band [IO.FileAttributes]::Hidden) -ne 0) -Checks @((Add-Check 'hidden set' $true ('attr=' + $attr))) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
