param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (New-TaskDir 'out') 'paint.png'
  New-Png -Path $f -W 200 -H 150 -R 255 -G 0 -B 0
  Out-Finish -Ok $true -Checks @((Add-Check 'red png written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
