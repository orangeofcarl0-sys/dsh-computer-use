# S4 eval shared prelude. Dot-source at top of every setup/oracle/cleanup/simulate script:
#   . (Join-Path $PSScriptRoot '..\lib\common.ps1')
# Each script declares: param([string]$TaskId = '')
# ASCII-only: PowerShell 5.1 parses BOM-less scripts as ANSI (no CJK comments here).
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not $TaskId -or $TaskId -eq '') {
  # dot-sourced: $MyInvocation.ScriptName is the CALLER script path; derive <id> from <id>.ps1
  $caller = ''
  try { $caller = $MyInvocation.ScriptName } catch {}
  if ($caller) { $TaskId = [IO.Path]::GetFileNameWithoutExtension((Split-Path -Leaf $caller)) }
}
if (-not $TaskId -or $TaskId -eq '') { $TaskId = ($env:S4_TASK + '') }
$Script:S4TaskId = $TaskId

function Get-TaskDir {
  if (-not $Script:S4TaskId) { throw 'S4: no task id (pass as arg 0 or set S4_TASK)' }
  return (Join-Path $env:USERPROFILE (Join-Path '.dsh\s4-evals' $Script:S4TaskId))
}

function Add-Check {
  # returns an ordered check entry: Add-Check 'name' $true 'detail'
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  [ordered]@{ name = $Name; ok = $Ok; detail = $Detail }
}

function Out-Finish {
  # oracle semantics: exit 0 pass / 1 fail / 2 env error. setup/cleanup/simulate: 0 ok / 2 env error.
  param([bool]$Ok, [object[]]$Checks = @(), [string]$EnvError = '', [string]$Kind = 'oracle')
  $payload = [ordered]@{ task = $Script:S4TaskId; kind = $Kind; ok = $Ok; envError = $EnvError; checks = $Checks }
  [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 6))
  try { [Console]::Out.Flush() } catch {}
  if ($EnvError -ne '') { exit 2 }
  if ($Ok) { exit 0 } else { exit 1 }
}

function New-TaskDir([string]$Sub = '') {
  $dir = Get-TaskDir
  if ($Sub) { $dir = Join-Path $dir $Sub }
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  return $dir
}

function Remove-TaskDir {
  $dir = Get-TaskDir
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

function New-Png {
  # solid-color PNG via System.Drawing (deterministic pixels)
  param([string]$Path, [int]$W, [int]$H, [int]$R, [int]$G, [int]$B)
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.Clear([System.Drawing.Color]::FromArgb(255, $R, $G, $B))
  $gfx.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-Docx {
  # minimal valid .docx (zip with forward-slash entries), no Office dependency
  param([string]$Path, [string]$Text)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $Path) { Remove-Item $Path -Force }
  $fs = [System.IO.File]::Create($Path)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  $ct = $zip.CreateEntry('[Content_Types].xml')
  Write-ZipEntry $ct '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  $rels = $zip.CreateEntry('_rels/.rels')
  Write-ZipEntry $rels '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  $doc = $zip.CreateEntry('word/document.xml')
  Write-ZipEntry $doc ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + $Text + '</w:t></w:r></w:p></w:body></w:document>')
  $zip.Dispose(); $fs.Dispose()
}

function Write-ZipEntry {
  param($Entry, [string]$Content)
  $s = $Entry.Open()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
  $s.Write($bytes, 0, $bytes.Length)
  $s.Dispose()
}

# ---- Win32 window helpers (each script runs in its own powershell process,
# so a fixed type name is safe to Add-Type unconditionally) ----
if (-not ('S4W32' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S4W32 {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct WPL { public uint length, flags, showCmd; public POINT min; public POINT max; public RECT normal; }
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WPL p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
}

function Find-WindowsByTitle([string]$Needle) {
  # UIA root-children window enumeration. Emits PSCustomObject per hit:
  # no output when none -> caller uses @(Find-WindowsByTitle ...) (empty array).
  # (Never return nested arrays from a PS function: pipeline unwrap makes the
  # shape unstable - empty case used to yield count=1 with an empty element.)
  Add-Type -AssemblyName UIAutomationClient
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($w in $wins) {
    $name = ''
    $h = 0
    try { $name = [string]$w.Current.Name } catch {}
    try { $h = [int]$w.Current.NativeWindowHandle } catch {}
    if ($name -and $h -ne 0 -and $name.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      [PSCustomObject]@{ hwnd = $h; title = $name }
    }
  }
}

function Get-Placement([int]$Hwnd) {
  $p = New-Object S4W32+WPL
  $p.length = [System.Runtime.InteropServices.Marshal]::SizeOf($p)
  [void][S4W32]::GetWindowPlacement([IntPtr]$Hwnd, [ref]$p)
  return $p
}
