param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$calc = $null
try {
  Add-Type -AssemblyName UIAutomationClient
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'ApplicationFrameWindow')
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $idCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CalculatorResults')
  foreach ($w in $wins) {
    $found = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $idCond)
    if ($found.Count -gt 0) { $calc = $found[0]; break }
  }
} catch {
  Out-Finish -Ok $false -Checks @() -EnvError ('uia: ' + $_.Exception.Message)
}
if (-not $calc) {
  $checks += (Add-Check 'calculator window found' $false 'no ApplicationFrameWindow hosting CalculatorResults (closed? wrong app?)')
  Out-Finish -Ok $false -Checks $checks
}
$name = ''
try { $name = [string]$calc.Current.Name } catch {}
$digits = ($name -replace '[^0-9]', '')
$checks += (Add-Check 'calculator window found' $true 'CalculatorResults located')
$checks += (Add-Check 'display text read' ($name.Length -gt 0) $name)
$ok = ($digits -eq '7006652')
$checks += (Add-Check 'value == 7006652' $ok ('parsed=' + $digits))
Out-Finish -Ok $ok -Checks $checks
