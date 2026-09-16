# Click-space calibration probe: one window with ONE large button at a known client offset.
# Clicking the button writes a marker file (proof of hit). Prints one JSON line with the
# window / client / button screen rects (physical px as seen by this process), then stays
# alive -AliveSec seconds (default 180) and closes itself. ASCII-only (PS 5.1 ANSI parsing).
param(
  [string]$Marker = "$env:TEMP\cu-click-probe-hit.txt",
  [int]$AliveSec = 180
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.Text = 'cu-click-probe'
$form.Size = New-Object System.Drawing.Size(420, 260)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(80, 520)
$form.ShowInTaskbar = $false
$form.TopMost = $true

$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'HIT'
$btn.Location = New-Object System.Drawing.Point(60, 60)
$btn.Size = New-Object System.Drawing.Size(260, 110)
$btn.Font = New-Object System.Drawing.Font('Consolas', 20)
$btn.Add_Click({
  try {
    $line = 'hit ' + (Get-Date).ToString('o')
    Add-Content -LiteralPath $Marker -Value $line -Encoding ASCII
  } catch {}
})
$form.Controls.Add($btn)

# also record raw WM_LBUTTONDOWN coordinates at the form level (independent of the button hit test)
$form.Add_MouseDown({
  param($s, $e)
  try {
    Add-Content -LiteralPath ($Marker + '.form') -Value ('down ' + $e.X + ',' + $e.Y + ' ' + (Get-Date).ToString('o')) -Encoding ASCII
  } catch {}
})

# unique title so several probes never collide
$form.Text = 'cu-click-probe-' + $PID
$form.Show()
for ($i = 0; $i -lt 12; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 80 }

$wr = $form.RectangleToScreen($form.ClientRectangle)
$br = $btn.RectangleToScreen($btn.ClientRectangle)
$payload = [ordered]@{
  hwnd = [int]$form.Handle
  pid = $PID
  title = $form.Text
  marker = $Marker
  window = [ordered]@{ l = $wr.Left; t = $wr.Top; w = $wr.Width; h = $wr.Height }
  button = [ordered]@{
    clientX = 60; clientY = 60; w = 260; h = 110
    screenL = $br.Left; screenT = $br.Top
    cx = [int]($br.Left + $br.Width / 2); cy = [int]($br.Top + $br.Height / 2)
  }
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
