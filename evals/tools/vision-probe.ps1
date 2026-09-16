# Vision probe window with exact screen rects (for localization ground truth).
# One form + three read-only TextBoxes; values come from files next to the script:
#   v0.txt / v1.txt / v2.txt (one 10-digit string each), fallback built-in defaults.
# Prints ONE json line: {"hwnd":..,"pid":..,"window":{l,t,w,h},"boxes":[{text,l,t,w,h,cx,cy}...]}
# then keeps the window open -KeepOpenSec seconds.
# ASCII-only on purpose: PowerShell 5.1 parses BOM-less scripts as ANSI.
param([int]$KeepOpenSec = 0)
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Add-Type -AssemblyName System.Windows.Forms

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'cu-vision-probe'
  $form.Size = New-Object System.Drawing.Size(560, 240)
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point(60, 760)
  $form.ShowInTaskbar = $false

  $v0 = '7082491365'
  $v1 = '5820946713'
  $v2 = '9361708245'
  $dir = $PSScriptRoot
  if (-not $dir) { $dir = (Get-Location).Path }
  if (Test-Path ($dir + '\v0.txt')) { $v0 = (Get-Content ($dir + '\v0.txt') -Raw).Trim() }
  if (Test-Path ($dir + '\v1.txt')) { $v1 = (Get-Content ($dir + '\v1.txt') -Raw).Trim() }
  if (Test-Path ($dir + '\v2.txt')) { $v2 = (Get-Content ($dir + '\v2.txt') -Raw).Trim() }

  $vals = @($v0, $v1, $v2)
  $boxes = @()
  for ($i = 0; $i -lt 3; $i++) {
    $tb = New-Object System.Windows.Forms.TextBox
    $tb.Location = New-Object System.Drawing.Point(20, (30 + $i * 50))
    $tb.Size = New-Object System.Drawing.Size(480, 27)
    $tb.ReadOnly = $true
    $tb.Font = New-Object System.Drawing.Font('Consolas', 16)
    $tb.Text = $vals[$i]
    $form.Controls.Add($tb)
    $boxes += $tb
  }

  $form.Show()
  for ($i = 0; $i -lt 12; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 80 }

  # screen rects: physical pixels as this process sees them
  $wl = [System.Windows.Forms.Control]::FromHandle($form.Handle)
  $formRect = $form.RectangleToScreen($form.ClientRectangle)
  $payload = [ordered]@{
    hwnd = [int]$form.Handle
    pid = $PID
    window = [ordered]@{ l = $formRect.Left; t = $formRect.Top; w = $formRect.Width; h = $formRect.Height }
    boxes = @()
  }
  for ($i = 0; $i -lt 3; $i++) {
    $r = $boxes[$i].RectangleToScreen($boxes[$i].ClientRectangle)
    $payload.boxes += [ordered]@{
      text = $vals[$i]
      l = $r.Left; t = $r.Top; w = $r.Width; h = $r.Height
      cx = [int]($r.Left + $r.Width / 2); cy = [int]($r.Top + $r.Height / 2)
    }
  }
  [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 5))
  [Console]::Out.Flush()

  if ($KeepOpenSec -gt 0) { Start-Sleep -Seconds $KeepOpenSec }
  else { Start-Sleep -Seconds 60 }
  $form.Close()
  exit 0
} catch {
  if ($form) { try { $form.Close() } catch {} }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
