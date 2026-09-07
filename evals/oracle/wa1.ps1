param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $docs = Join-Path (Get-TaskDir) 'Documents'
  $arch = Join-Path $docs 'Archive'
  $c0 = (Test-Path $arch)
  $checks += (Add-Check 'Archive folder exists' $c0 $arch)
  $inside = @()
  if ($c0) { $inside = @(Get-ChildItem -LiteralPath $arch -Filter '*.docx' -File) }
  $names = ($inside | ForEach-Object { $_.Name }) -join ','
  $need = @('Doc01.docx', 'Doc02.docx', 'Doc03.docx')
  $all = $true
  foreach ($n in $need) { if (-not ($inside | Where-Object { $_.Name -ieq $n })) { $all = $false } }
  $checks += (Add-Check 'all 3 docx inside Archive' ($c0 -and ($inside.Count -eq 3) -and $all) ('inside=' + $names))
  $outside = @(Get-ChildItem -LiteralPath $docs -Filter '*.docx' -File)
  $checks += (Add-Check 'no docx left outside Archive' ($outside.Count -eq 0) (($outside | ForEach-Object { $_.Name }) -join ','))
  $ok = $c0 -and ($inside.Count -eq 3) -and $all -and ($outside.Count -eq 0)
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
