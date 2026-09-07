param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$expected = "S4-T01 line one.`nS4-T01 line two."
try {
  $target = Join-Path (Get-TaskDir) 'target\note.txt'
  if (-not (Test-Path $target)) {
    $checks += (Add-Check 'file exists' $false $target)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $target)
  $raw = [IO.File]::ReadAllText($target)
  $norm = $raw -replace "`r`n", "`n"
  $match = ($norm -eq $expected)
  $checks += (Add-Check 'content exact match' $match ('len=' + $norm.Length + ' head=' + $norm.Substring(0, [Math]::Min(60, $norm.Length))))
  Out-Finish -Ok $match -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
