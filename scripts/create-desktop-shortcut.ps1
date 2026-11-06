$ErrorActionPreference = 'Stop'

$projectDirectory = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectDirectory 'dist\PageDebugger-win32-x64\PageDebugger.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'Packaged client not found. Run npm run package:win first.'
}
$executable = (Resolve-Path -LiteralPath $executable).Path
$desktopDirectory = [Environment]::GetFolderPath('Desktop')
if (-not $desktopDirectory) { throw 'Windows desktop directory is unavailable.' }

$shortcutPath = Join-Path $desktopDirectory 'Page Debugger.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = Split-Path -Parent $executable
$shortcut.IconLocation = "$executable,0"
$shortcut.Description = 'Page Debugger - local browser debugging workspace'
$shortcut.WindowStyle = 1
$shortcut.Save()

$savedShortcut = $shortcutShell.CreateShortcut($shortcutPath)
if ($savedShortcut.TargetPath -ne $executable) { throw 'Shortcut target verification failed.' }
[PSCustomObject]@{
    Shortcut = $shortcutPath
    Target = $savedShortcut.TargetPath
} | ConvertTo-Json
