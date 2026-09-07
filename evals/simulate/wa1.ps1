param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $docs = Join-Path (Get-TaskDir) 'Documents'
  $arch = Join-Path $docs 'Archive'
  New-Item -ItemType Directory -Path $arch -Force | Out-Null
  Get-ChildItem -LiteralPath $docs -Filter '*.docx' -File | Move-Item -Destination $arch
  Out-Finish -Ok $true -Checks @() -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
