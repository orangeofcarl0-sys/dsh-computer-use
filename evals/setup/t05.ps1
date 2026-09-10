param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'saveas'
  $f = Join-Path $dir 'out-ansi.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  # pre-stage: notepad already showing the source text (removes launch+typing cost;
  # what remains under test is the Save-As dialog + ANSI encoding choice)
  $src = New-TaskDir 'src'
  $draft = Join-Path $src 'draft.txt'
  [IO.File]::WriteAllText($draft, "S4-T05 ANSI check.`r`n", [Text.Encoding]::Default)
  Get-Process -Name 'Notepad' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
  Start-Process -FilePath 'notepad.exe' -ArgumentList @($draft)
  $deadline = (Get-Date).AddSeconds(15)
  $win = @()
  while ((Get-Date) -lt $deadline) {
    $win = @(Find-WindowsByTitle 'draft.txt')
    if ($win.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $checks += (Add-Check 'notepad opened with draft.txt' ($win.Count -gt 0) (($win | ForEach-Object { $_.title }) -join ' | '))
  $checks += (Add-Check 'no stale out-ansi.txt' (-not (Test-Path $f)) $f)
  Out-Finish -Ok (($win.Count -gt 0) -and (-not (Test-Path $f))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
