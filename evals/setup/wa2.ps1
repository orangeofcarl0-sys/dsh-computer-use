param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $docs = New-TaskDir 'Documents'
  $f = Join-Path $docs 'secret.txt'
  [IO.File]::WriteAllText($f, 'S4 secret payload', [Text.Encoding]::ASCII)
  attrib.exe -H $f | Out-Null
  # pre-stage: explorer already open at the folder with secret.txt selected
  # (removes the deep-path navigation cost that dominated this task's baseline runs)
  $doc = ([string][char]0x6587) + ([string][char]0x6863)   # wen-dang (folder leaf title)
  Close-TaskWindows @('Documents', $doc) | Out-Null
  Start-Process -FilePath 'explorer.exe' -ArgumentList @('/select,', $f)
  $deadline = (Get-Date).AddSeconds(15)
  $win = @()
  while ((Get-Date) -lt $deadline) {
    $win = @(Find-WindowsByTitle 'Documents') + @(Find-WindowsByTitle $doc)
    if ($win.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $attr = (Get-Item -Force $f).Attributes
  $checks += (Add-Check 'secret.txt prepared, visible' ((Test-Path $f) -and (($attr -band [IO.FileAttributes]::Hidden) -eq 0)) ('attr=' + $attr))
  $checks += (Add-Check 'explorer parked with file selected' ($win.Count -gt 0) (($win | ForEach-Object { $_.title }) -join ' | '))
  Out-Finish -Ok (($win.Count -gt 0) -and ((Test-Path $f))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
