param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'files'
  $f = Join-Path $dir 'report-q7.txt'
  [IO.File]::WriteAllText($f, 'Q7 report body 12345', [Text.Encoding]::ASCII)
  Remove-Item (Join-Path $dir 'report-q7-final.txt') -Force -ErrorAction SilentlyContinue
  # pre-stage: explorer already parked at the sandbox folder (removes deep-path navigation cost)
  Close-TaskWindows @('files') | Out-Null
  Start-Process -FilePath 'explorer.exe' -ArgumentList @($dir)
  $deadline = (Get-Date).AddSeconds(15)
  $win = @()
  while ((Get-Date) -lt $deadline) {
    $win = @(Find-WindowsByTitle 'files')
    if ($win.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $checks += (Add-Check 'report-q7.txt prepared' (Test-Path $f) $f)
  $checks += (Add-Check 'explorer parked at files dir' ($win.Count -gt 0) (($win | ForEach-Object { $_.title }) -join ' | '))
  Out-Finish -Ok ((Test-Path $f) -and ($win.Count -gt 0)) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
