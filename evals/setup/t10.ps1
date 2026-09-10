param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'swap'
  $a = Join-Path $dir 'a.txt'
  $b = Join-Path $dir 'b.txt'
  [IO.File]::WriteAllText($a, 'AAA-content-original-a', [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText($b, 'BBB-content-original-b', [Text.Encoding]::ASCII)
  # pre-stage: both files loaded in Notepad. Win11 Notepad may host them as two tabs in ONE
  # window (title then shows only the active tab), so verify via the UIA tab/list items.
  Close-TaskWindows | Out-Null
  Start-Process -FilePath 'notepad.exe' -ArgumentList @($a)
  Start-Sleep -Milliseconds 1500
  Start-Process -FilePath 'notepad.exe' -ArgumentList @($b)
  $deadline = (Get-Date).AddSeconds(15)
  $tabs = @()
  while ((Get-Date) -lt $deadline) {
    Add-Type -AssemblyName UIAutomationClient
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Window)
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    $tabs = @()
    foreach ($w in $wins) {
      $n = ''
      try { $n = [string]$w.Current.Name } catch {}
      if ($n -match '\.txt') {
        $items = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
          (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem)))
        foreach ($it in $items) { try { $tabs += [string]$it.Current.Name } catch {} }
      }
    }
    $hasA = @($tabs | Where-Object { $_ -match 'a\.txt' }).Count -gt 0
    $hasB = @($tabs | Where-Object { $_ -match 'b\.txt' }).Count -gt 0
    if ($hasA -and $hasB) { break }
    Start-Sleep -Milliseconds 700
  }
  $hasA = @($tabs | Where-Object { $_ -match 'a\.txt' }).Count -gt 0
  $hasB = @($tabs | Where-Object { $_ -match 'b\.txt' }).Count -gt 0
  $checks += (Add-Check 'files prepared' ((Test-Path $a) -and (Test-Path $b)) ($a + ' ; ' + $b))
  $checks += (Add-Check 'both documents loaded in Notepad (window or tab)' ($hasA -and $hasB) ('tabs=' + (($tabs | Select-Object -Unique) -join ',')))
  Out-Finish -Ok ($hasA -and $hasB) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
