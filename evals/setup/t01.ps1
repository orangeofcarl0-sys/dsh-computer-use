param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $target = Join-Path (New-TaskDir 'target') 'note.txt'
  if (Test-Path $target) { Remove-Item $target -Force }
  # pre-stage: a blank Notepad window (removes launch+discovery cost; oracle unchanged)
  Get-Process -Name 'Notepad' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
  Start-Process -FilePath 'notepad.exe'
  $untitled = ([string][char]0x65E0) + ([string][char]0x6807) + ([string][char]0x9898)
  $deadline = (Get-Date).AddSeconds(15)
  $win = @()
  while ((Get-Date) -lt $deadline) {
    $win = @(Find-WindowsByTitle $untitled) + @(Find-WindowsByTitle 'Notepad')
    if ($win.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $checks += (Add-Check 'blank notepad opened' ($win.Count -gt 0) (($win | ForEach-Object { $_.title }) -join ' | '))
  $checks += (Add-Check 'target dir prepared, no stale file' (-not (Test-Path $target)) (Join-Path (Get-TaskDir) 'target'))
  Out-Finish -Ok (($win.Count -gt 0) -and (-not (Test-Path $target))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
