param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $target = Join-Path (New-TaskDir 'target') 'note.txt'
  if (Test-Path $target) { Remove-Item $target -Force }
  Set-Content -Path $target -Value '' -Encoding ASCII -NoNewline
  Remove-Item $target -Force
  $checks += (Add-Check 'target dir prepared' (Test-Path (New-TaskDir 'target')) (New-TaskDir 'target'))
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
