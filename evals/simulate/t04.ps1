param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  # drive the real calculator via SendKeys (foreground, independent of the plugin)
  Start-Process -FilePath 'calc.exe'
  Start-Sleep -Seconds 3
  $sh = New-Object -ComObject WScript.Shell
  $act = $sh.AppActivate('Calculator')
  if (-not $act) { $act = $sh.AppActivate(0) }
  Start-Sleep -Milliseconds 800
  $sh.SendKeys('1234*5678=')
  Start-Sleep -Seconds 2
  $checks += (Add-Check 'calculator driven' $true 'keys sent: 1234*5678=')
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
