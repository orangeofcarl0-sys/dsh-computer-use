param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $src = Join-Path (Get-TaskDir) 'img\circle-src.png'
  $dst = Join-Path (Get-TaskDir) 'Downloads\circle.png'
  if (-not (Test-Path $src)) { Out-Finish -Ok $false -Checks @() -EnvError 'missing src (run setup first)' -Kind 'simulate' }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Out-Finish -Ok $true -Checks @((Add-Check 'copied' (Test-Path $dst) $dst)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
