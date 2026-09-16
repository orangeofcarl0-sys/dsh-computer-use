# Click-space calibration probe (v2): a form with a DRAWN target rect.
# Every mouse-down on the form is logged with its client-logic coordinates and whether it
# landed inside the rect -> one sweep yields both the coordinate mapping and a hit verdict.
# Prints one JSON line (window/client/rect rects in this process's units), stays alive
# -AliveSec seconds, then closes itself. ASCII-only (PS 5.1 ANSI parsing).
param(
  [string]$Marker = "$env:TEMP\cu-click-probe2.txt",
  [int]$AliveSec = 180
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$RectX = 60; $RectY = 60; $RectW = 260; $RectH = 110

$form = New-Object System.Windows.Forms.Form
$form.Text = 'cu-click-probe2-' + $PID
$form.Size = New-Object System.Drawing.Size(420, 260)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(80, 520)
$form.ShowInTaskbar = $false
$form.TopMost = $true

$form.Add_Paint({
  param($s, $e)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 144, 255))
  $e.Graphics.FillRectangle($brush, $RectX, $RectY, $RectW, $RectH)
  $brush.Dispose()
})

$form.Add_MouseDown({
  param($s, $e)
  $inside = ($e.X -ge $RectX -and $e.X -le ($RectX + $RectW) -and $e.Y -ge $RectY -and $e.Y -le ($RectY + $RectH))
  $tag = if ($inside) { 'INSIDE' } else { 'outside' }
  try {
    Add-Content -LiteralPath $Marker -Value ("$tag client=$($e.X),$($e.Y)") -Encoding ASCII
  } catch {}
})

$form.Show()
for ($i = 0; $i -lt 12; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 80 }

$cr = $form.RectangleToScreen($form.ClientRectangle)
$payload = [ordered]@{
  pid = $PID
  title = $form.Text
  marker = $Marker
  clientScreen = [ordered]@{ l = $cr.Left; t = $cr.Top; w = $cr.Width; h = $cr.Height }
  rect = [ordered]@{ x = $RectX; y = $RectY; w = $RectW; h = $RectH; cx = ($RectX + [int]($RectW / 2)); cy = ($RectY + [int]($RectH / 2)) }
}
$payload.line = ConvertTo-Json $payload -Compress -Depth 5
Write-Output $payload.line
[Console]::Out.Flush()

$deadline = (Get-Date).AddSeconds($AliveSec)
while ((Get-Date) -lt $deadline) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 120
}
$form.Close()
exit 0
