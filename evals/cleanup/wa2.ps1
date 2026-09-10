param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $doc = ([string][char]0x6587) + ([string][char]0x6863)
  Close-TaskWindows @('Documents', $doc) | Out-Null
  Remove-TaskDir
  Out-Finish -Ok $true -Checks @() -Kind 'cleanup'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'cleanup'
}
