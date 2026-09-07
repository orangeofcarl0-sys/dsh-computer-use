param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$expected = 'S4-T08 hello from run dialog'
try {
  $f = Join-Path (Get-TaskDir) 'out\hello.txt'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $f)
  $norm = ([IO.File]::ReadAllText($f)) -replace "`r`n", "`n"
  $match = ($norm.Trim() -eq $expected)
  $checks += (Add-Check 'content match' $match ('read=' + $norm.Trim()))
  Out-Finish -Ok $match -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
