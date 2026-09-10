# Eval hygiene helper. ASCII-only (PS 5.1 parses BOM-less scripts as ANSI).
#
# What it does by default (non-destructive):
#   - close notepad/explorer windows left by tasks (title-scoped)
#   - report notepad restore-state presence (TabState/*.bin) and running notepads
#
# OPT-IN destructive step:
#   -ClearNotepadTabState deletes %LOCALAPPDATA%\Packages\Microsoft.WindowsNotepad_*\LocalState\TabState\*.bin
#   This DISCARDS unsaved Notepad documents (Win11 Notepad restores the previous session's
#   tabs on launch -- agent leftovers get resurrected and pollute later tasks; it caused the
#   t07 cascade failure in the 2026-09-08 baseline). Only run it when you accept losing
#   whatever unsaved Notepad tabs exist on this machine. Notepad must be closed first.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File evals/hygiene.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File evals/hygiene.ps1 -ClearNotepadTabState
param([switch]$ClearNotepadTabState)
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$ErrorActionPreference = 'Continue'

$closed = Close-TaskWindows
$np = @(Get-Process -Name 'Notepad' -ErrorAction SilentlyContinue)
$pkg = Join-Path $env:LOCALAPPDATA 'Packages'
$tabDirs = @()
if (Test-Path $pkg) {
  $tabDirs = @(Get-ChildItem -Path $pkg -Directory -Filter 'Microsoft.WindowsNotepad_*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'LocalState\TabState' } | Where-Object { Test-Path $_ })
}
$bins = @()
foreach ($d in $tabDirs) { $bins += @(Get-ChildItem -Path $d -Filter '*.bin' -File -ErrorAction SilentlyContinue) }
Write-Output ("closed_windows=" + $closed)
Write-Output ("notepad_processes=" + $np.Count)
Write-Output ("tabstate_files=" + $bins.Count + " in " + $tabDirs.Count + " package dir(s)")

if ($ClearNotepadTabState) {
  if ($np.Count -gt 0) {
    Write-Output 'refused: close all Notepad windows first (TabState is written on exit)'
    exit 1
  }
  $removed = 0
  foreach ($b in $bins) { try { Remove-Item -LiteralPath $b.FullName -Force; $removed++ } catch {} }
  Write-Output ("tabstate_removed=" + $removed)
}
exit 0
