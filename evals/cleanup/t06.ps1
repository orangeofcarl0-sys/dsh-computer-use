param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  Set-Clipboard -Value ' '
  Remove-TaskDir
  Out-Finish -Ok $true -Checks @() -Kind 'cleanup'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'cleanup'
}
