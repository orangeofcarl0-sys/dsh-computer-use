param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $win = @(Find-WindowsByTitle 'workfile.txt')
  if ($win.Count -eq 0) {
    $checks += (Add-Check 'window exists' $false 'no workfile.txt notepad window')
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'window exists' $true (($win | ForEach-Object { $_.title }) -join ' | '))
  $p = Get-Placement $win[0].hwnd
  $maxed = ($p.showCmd -eq 3)
  $checks += (Add-Check 'placement == SW_SHOWMAXIMIZED' $maxed ('showCmd=' + $p.showCmd))
  Out-Finish -Ok $maxed -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
