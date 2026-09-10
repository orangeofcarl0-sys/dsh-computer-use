param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'pasted.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  $payload = 'S4-CLIP-6f3a9b payload line'
  $clip = ''
  # clipboard can be transiently locked by another process - retry set+verify
  for ($i = 0; $i -lt 4 -and $clip -ne $payload; $i++) {
    try { Set-Clipboard -Value $payload } catch {}
    Start-Sleep -Milliseconds 600
    try { $clip = (Get-Clipboard -Raw) } catch { $clip = '' }
    if ($clip) { $clip = $clip.TrimEnd("`r", "`n") }
  }
  # pre-stage: blank notepad already open (removes launch cost; clipboard+paste+save remains)
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
  $checks += (Add-Check 'clipboard prepared' ($clip -eq $payload) ('clip=' + $clip))
  $checks += (Add-Check 'blank notepad opened' ($win.Count -gt 0) (($win | ForEach-Object { $_.title }) -join ' | '))
  Out-Finish -Ok (($clip -eq $payload) -and ($win.Count -gt 0)) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
