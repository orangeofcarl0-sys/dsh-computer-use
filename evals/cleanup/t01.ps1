param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  # close notepad windows left by the task (agent leftovers); scoped to titles the task produces
  # untitled marker built from code points (U+65E0 U+6807 U+9898) - PS1 stays ASCII-only
  $untitled = ([string][char]0x65E0) + ([string][char]0x6807) + ([string][char]0x9898)
  Get-Process -Name 'Notepad' -ErrorAction SilentlyContinue | Where-Object {
    ($_.MainWindowTitle -match 'note\.txt') -or ($_.MainWindowTitle -match 'Untitled') -or ($_.MainWindowTitle.Contains($untitled))
  } | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-TaskDir
  Out-Finish -Ok $true -Checks @() -Kind 'cleanup'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'cleanup'
}
