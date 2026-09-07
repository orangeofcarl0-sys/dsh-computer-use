param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (New-TaskDir 'out') 'resized.png'
  New-Png -Path $f -W 800 -H 600 -R 128 -G 128 -B 128
  Out-Finish -Ok $true -Checks @((Add-Check '800x600 png written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
