# UIA password scan sidecar — outputs single-line JSON on stdout.
# ASCII-only on purpose: PowerShell 5.1 parses BOM-less scripts as ANSI.
# Usage: powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File uia-password-scan.ps1 -Hwnd <hwnd>
# Output: {"window":{"left":..,"top":..,"width":..,"height":..},"password":[{"name":"..","x":..,"y":..,"w":..,"h":..}]}
# Failure: nonzero exit + stderr. Pure read: no network, no file writes.
param(
  [Parameter(Mandatory = $true)][long]$Hwnd
)
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class W32Scan {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
}
"@

  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
  if (-not $root) { throw "no automation element for hwnd $Hwnd" }
  $wr = $root.Current.BoundingRectangle

  # Password = UIA IsPassword (modern providers: XAML/UWP) OR ES_PASSWORD style bit
  # on the element's native hwnd (classic Win32 Edit — managed/com UIA maps this to
  # IsPassword=false, verified by probe; the style bit is the system-truth signal).
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)

  $items = @()
  foreach ($el in $all) {
    try {
      $isPw = $false
      try { $isPw = $el.Current.IsPassword } catch {}
      if (-not $isPw) {
        $h = 0
        try { $h = [int]$el.Current.NativeWindowHandle } catch {}
        if ($h -ne 0) {
          $style = [W32Scan]::GetWindowLong([IntPtr]$h, -16)
          if (($style -band 0x20) -ne 0) { $isPw = $true }
        }
      }
      if (-not $isPw) { continue }
      $r = $el.Current.BoundingRectangle
      if ($r.Width -le 0 -and $r.Height -le 0) { continue }
      $items += ,@{ name = [string]$el.Current.Name; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
    } catch { continue }
  }

  # Build JSON via ConvertTo-Json of the wrapper; Node side normalizes single-element unwrap.
  $payload = [ordered]@{
    window = [ordered]@{ left = [int]$wr.X; top = [int]$wr.Y; width = [int]$wr.Width; height = [int]$wr.Height }
    password = $items
    count = $items.Count
  }
  [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 4))
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
