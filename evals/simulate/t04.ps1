param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $pid2 = Start-Calculator
  if (-not $pid2) { Out-Finish -Ok $false -Checks @() -EnvError 'calculator window never appeared' -Kind 'simulate' }
  $sh = New-Object -ComObject WScript.Shell
  $sent = $false
  for ($i = 0; $i -lt 5 -and -not $sent; $i++) {
    [void]$sh.AppActivate($pid2)
    Start-Sleep -Milliseconds 700
    $sh.SendKeys('1234*5678=')
    Start-Sleep -Seconds 2
    # read back the display via UIA; retry keys if empty/missing
    try {
      Add-Type -AssemblyName UIAutomationClient
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'ApplicationFrameWindow')
      $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
      $idCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CalculatorResults')
      foreach ($w in $wins) {
        $found = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $idCond)
        if ($found.Count -gt 0) {
          $name = [string]$found[0].Current.Name
          $digits = ($name -replace '[^0-9]', '')
          if ($digits -eq '7006652') { $sent = $true }
          break
        }
      }
    } catch {}
  }
  $checks += (Add-Check 'calculator driven with readback' $sent ('pid=' + $pid2))
  Out-Finish -Ok $sent -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError $_.Exception.Message -Kind 'simulate'
}
