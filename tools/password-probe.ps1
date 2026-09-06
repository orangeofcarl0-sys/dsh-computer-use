# Self-contained A6 probe: builds a WinForms window with a plain TextBox and a
# password TextBox (PasswordChar), then scans ITSELF via UIA — validates the B1
# structural path (IsPassword OR ES_PASSWORD style bit) without needing the driver.
# -KeepOpenSec N: print {"hwnd":N} first line, keep the window open N seconds
# (lets the shipping sidecar run against it), then continue scanning.
# ASCII-only on purpose: PowerShell 5.1 parses BOM-less scripts as ANSI.
param([int]$KeepOpenSec = 0)
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName UIAutomationClient

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'cu-cred-probe'
  $form.Size = New-Object System.Drawing.Size(420, 200)
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point(40, 40)
  $form.ShowInTaskbar = $false

  $tb = New-Object System.Windows.Forms.TextBox
  $tb.Location = New-Object System.Drawing.Point(20, 30)
  $tb.Width = 340
  $form.Controls.Add($tb)

  $pb = New-Object System.Windows.Forms.TextBox
  $pb.Location = New-Object System.Drawing.Point(20, 80)
  $pb.Width = 340
  $pb.PasswordChar = [char]'*'
  $form.Controls.Add($pb)

  # P/Invoke: read GWL_STYLE to check ES_PASSWORD (0x20) on a child hwnd
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class W32 {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc cb, IntPtr lParam);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
}
"@

  $form.Show()
  # UIA tree needs pumping to materialize child elements — settle before scanning.
  for ($i = 0; $i -lt 10; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 80 }

  if ($KeepOpenSec -gt 0) {
    [Console]::Out.WriteLine(('{"hwnd":' + [int]$form.Handle + ',"pid":' + $PID + '}'))
    [Console]::Out.Flush()
    Start-Sleep -Seconds $KeepOpenSec
  }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($form.Handle)
  $wr = $root.Current.BoundingRectangle
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsPasswordProperty, $true)
  $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)

  $hits = @()
  foreach ($el in $found) {
    $r = $el.Current.BoundingRectangle
    $hits += ,@{ name = [string]$el.Current.Name; cls = [string]$el.Current.ClassName; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
  }

  # Cross-check: walk all descendants and read Current.IsPassword directly.
  $walked = 0; $directHits = @(); $dump = @()
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    $walked++
    $r = $el.Current.BoundingRectangle
    $isPw = $false
    try { $isPw = $el.Current.IsPassword } catch {}
    $hWnd = 0
    try { $hWnd = [int]$el.Current.NativeWindowHandle } catch {}
    $style = $null; $esPw = $null
    if ($hWnd -ne 0) {
      $style = [W32]::GetWindowLong([IntPtr]$hWnd, -16)
      $esPw = (($style -band 0x20) -ne 0)
    }
    $dump += ,@{ cls = [string]$el.Current.ClassName; name = [string]$el.Current.Name; isPassword = $isPw; hwnd = $hWnd; esPassword = $esPw; x = [int]$r.X; y = [int]$r.Y }
    if ($isPw -or $esPw) {
      $directHits += ,@{ name = [string]$el.Current.Name; cls = [string]$el.Current.ClassName; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
    }
  }

  # Win32 ground truth: EnumChildWindows + GWL_STYLE
  $children = @()
  $cb = [W32+EnumProc]{ param($h, $l)
    $r = New-Object W32+RECT
    [void][W32]::GetWindowRect($h, [ref]$r)
    $children += ,@{ hwnd = [int]$h; cls = 'child'; style = ([W32]::GetWindowLong($h, -16)); x = [int]$r.L; y = [int]$r.T; w = ([int]$r.R - [int]$r.L); h = ([int]$r.B - [int]$r.T) }
    return $true
  }
  [void][W32]::EnumChildWindows($form.Handle, $cb, [IntPtr]::Zero)

  $payload = [ordered]@{
    probe = [ordered]@{
      walked = $walked
      win32children = $children
      dump = $dump
    }
    scan = [ordered]@{
      window = [ordered]@{ left = [int]$wr.X; top = [int]$wr.Y; width = [int]$wr.Width; height = [int]$wr.Height }
      password = $hits
      count = $hits.Count
    }
    direct = [ordered]@{ password = $directHits; count = $directHits.Count }
  }
  $form.Close()
  [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 5))
  exit 0
} catch {
  if ($form) { try { $form.Close() } catch {} }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
