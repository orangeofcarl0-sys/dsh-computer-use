param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
try {
  $f = Join-Path (Get-TaskDir) 'Pictures\png_files.txt'
  $content = "alpha-001.png`r`nbeta-002.png`r`ngamma-003.png`r`ndelta-004.png"
  [IO.File]::WriteAllText($f, $content, [Text.Encoding]::ASCII)
  Out-Finish -Ok $true -Checks @((Add-Check 'png_files.txt written' (Test-Path $f) $f)) -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
