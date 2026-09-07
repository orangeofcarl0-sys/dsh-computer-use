param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$expected = 'S4-CLIP-6f3a9b payload line'
try {
  $f = Join-Path (Get-TaskDir) 'out\pasted.txt'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $f)
  $norm = ([IO.File]::ReadAllText($f)) -replace "`r`n", "`n"
  $match = ($norm.Trim() -eq $expected)
  $checks += (Add-Check 'content == clipboard payload' $match ('read=' + $norm.Trim()))
  Out-Finish -Ok $match -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
