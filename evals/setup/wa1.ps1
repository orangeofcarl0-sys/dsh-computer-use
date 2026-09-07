param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $docs = New-TaskDir 'Documents'
  New-Docx -Path (Join-Path $docs 'Doc01.docx') -Text 'S4 wa1 doc 01'
  New-Docx -Path (Join-Path $docs 'Doc02.docx') -Text 'S4 wa1 doc 02'
  New-Docx -Path (Join-Path $docs 'Doc03.docx') -Text 'S4 wa1 doc 03'
  if (Test-Path (Join-Path $docs 'Archive')) { Remove-Item (Join-Path $docs 'Archive') -Recurse -Force }
  $left = @(Get-ChildItem -LiteralPath $docs -Filter '*.docx' -File)
  $checks += (Add-Check '3 docx prepared' ($left.Count -eq 3) (($left | ForEach-Object { $_.Name }) -join ','))
  Out-Finish -Ok ($left.Count -eq 3) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
