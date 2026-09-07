param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $docs = New-TaskDir 'Documents'
  $f = Join-Path $docs 'secret.txt'
  [IO.File]::WriteAllText($f, 'S4 secret payload', [Text.Encoding]::ASCII)
  # ensure not hidden from a previous run
  attrib.exe -H $f | Out-Null
  $attr = (Get-Item $f).Attributes
  $checks += (Add-Check 'secret.txt prepared, visible' ((Test-Path $f) -and (($attr -band [IO.FileAttributes]::Hidden) -eq 0)) ('attr=' + $attr))
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
