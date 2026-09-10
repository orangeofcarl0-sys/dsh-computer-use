param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'paint.png'
  if (Test-Path $f) { Remove-Item $f -Force }
  # pre-stage: Paint already open (removes launch cost; canvas size + fill + save remains)
  Get-Process -Name 'mspaint' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Start-Process -FilePath 'mspaint.exe'
  $huatu = ([string][char]0x753B) + ([string][char]0x56FE)   # hua-tu
  $deadline = (Get-Date).AddSeconds(20)
  $win = @()
  while ((Get-Date) -lt $deadline) {
    $win = @(Find-WindowsByTitle 'Paint') + @(Find-WindowsByTitle $huatu)
    if ($win.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $checks += (Add-Check 'paint opened' ($win.Count -gt 0) (($win | ForEach-Object { $_.title }) -join ' | '))
  $checks += (Add-Check 'no stale paint.png' (-not (Test-Path $f)) $f)
  Out-Finish -Ok (($win.Count -gt 0) -and (-not (Test-Path $f))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
