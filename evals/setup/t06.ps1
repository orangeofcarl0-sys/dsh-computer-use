param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'pasted.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  Set-Clipboard -Value 'S4-CLIP-6f3a9b payload line'
  $clip = Get-Clipboard
  $checks += (Add-Check 'clipboard prepared' ($clip -eq 'S4-CLIP-6f3a9b payload line') ('clip=' + $clip))
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
