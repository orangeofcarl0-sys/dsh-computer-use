param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $f = Join-Path (Get-TaskDir) 'Downloads\circle.png'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $f)
  $bytes = [IO.File]::ReadAllBytes($f)
  $magic = ($bytes.Length -ge 8 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4E -and $bytes[3] -eq 0x47)
  $checks += (Add-Check 'PNG magic header' $magic ('first4=' + (($bytes | Select-Object -First 4 | ForEach-Object { $_.ToString('X2') }) -join ' ')))
  Out-Finish -Ok $magic -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
