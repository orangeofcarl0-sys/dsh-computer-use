param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $win = @(Find-WindowsByTitle 'workfile.txt')
  foreach ($w in $win) { [void][S4W32]::PostMessage([IntPtr]$w.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
  Start-Sleep -Milliseconds 800
  Remove-TaskDir
  Out-Finish -Ok $true -Checks @() -Kind 'cleanup'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'cleanup'
}
