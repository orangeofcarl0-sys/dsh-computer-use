param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = Get-TaskDir
  $old = Join-Path $dir 'files\report-q7.txt'
  $new = Join-Path $dir 'files\report-q7-final.txt'
  $oldGone = -not (Test-Path $old)
  $newThere = (Test-Path $new)
  $checks += (Add-Check 'old name gone' $oldGone $old)
  $checks += (Add-Check 'new name exists' $newThere $new)
  $same = $false
  if ($newThere) {
    $norm = ([IO.File]::ReadAllText($new)) -replace "`r`n", "`n"
    $same = ($norm.Trim() -eq 'Q7 report body 12345')
  }
  $checks += (Add-Check 'content unchanged' $same '')
  Out-Finish -Ok ($oldGone -and $newThere -and $same) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
