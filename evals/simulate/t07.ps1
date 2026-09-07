param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $win = @(Find-WindowsByTitle 'workfile.txt')
  if ($win.Count -eq 0) { Out-Finish -Ok $false -Checks @() -EnvError 'no workfile.txt window to maximize (run setup first)' -Kind 'simulate' }
  [void][S4W32]::ShowWindow([IntPtr]$win[0].hwnd, 3)
  Start-Sleep -Milliseconds 500
  $p = Get-Placement $win[0].hwnd
  Out-Finish -Ok ($p.showCmd -eq 3) -Checks @((Add-Check 'maximized' ($p.showCmd -eq 3) ('showCmd=' + $p.showCmd))) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
