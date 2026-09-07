param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir
  $f = Join-Path $dir 'workfile.txt'
  if (-not (Test-Path $f)) { Set-Content -Path $f -Value '' -Encoding ASCII -NoNewline }
  # close any stale workfile notepad from a previous run
  $stale = @(Find-WindowsByTitle 'workfile.txt')
  foreach ($w in $stale) { [void][S4W32]::PostMessage([IntPtr]$w.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
  if ($stale.Count -gt 0) { Start-Sleep -Milliseconds 800 }
  Start-Process -FilePath 'notepad.exe' -ArgumentList @($f)
  $deadline = (Get-Date).AddSeconds(15)
  $win = @()
  while ((Get-Date) -lt $deadline) {
    $win = @(Find-WindowsByTitle 'workfile.txt')
    if ($win.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $checks += (Add-Check 'workfile.txt notepad opened' ($win.Count -gt 0) (($win | ForEach-Object { $_.title }) -join ' | '))
  Out-Finish -Ok ($win.Count -gt 0) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
