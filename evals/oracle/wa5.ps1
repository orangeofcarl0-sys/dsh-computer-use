param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $pics = Get-TaskDir
  $f = Join-Path $pics 'Pictures\png_files.txt'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'png_files.txt exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'png_files.txt exists' $true $f)
  $raw = [IO.File]::ReadAllText($f)
  $lines = @($raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  $need = @('alpha-001.png', 'beta-002.png', 'gamma-003.png', 'delta-004.png')
  $decoys = @('notes.txt', 'cover.jpg')
  $all = $true
  foreach ($n in $need) {
    $hit = ($lines | Where-Object { $_.ToLower().Contains($n.ToLower()) }).Count
    if ($hit -lt 1) { $all = $false; $checks += (Add-Check ('listed: ' + $n) $false 'missing') }
  }
  if ($all) { $checks += (Add-Check 'all 4 png names listed' $true (($lines) -join ' | ')) }
  $clean = $true
  foreach ($d in $decoys) {
    $hit = ($lines | Where-Object { $_.ToLower().Contains($d.ToLower()) }).Count
    if ($hit -ge 1) { $clean = $false; $checks += (Add-Check ('decoy absent: ' + $d) $false 'decoy listed') }
  }
  if ($clean) { $checks += (Add-Check 'no decoys listed' $true '') }
  Out-Finish -Ok ($all -and $clean) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
