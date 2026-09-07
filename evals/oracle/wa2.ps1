param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $f = Join-Path (Get-TaskDir) 'Documents\secret.txt'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $attr = (Get-Item -Force $f).Attributes
  $hidden = (($attr -band [IO.FileAttributes]::Hidden) -ne 0)
  $checks += (Add-Check 'file exists' $true $f)
  $checks += (Add-Check 'attributes contain Hidden' $hidden ('attr=' + $attr))
  Out-Finish -Ok $hidden -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
