$ErrorActionPreference = "Stop"

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $sourceDir "FlowGuardian.zip"
$targetRoot = Join-Path $env:LOCALAPPDATA "Programs"
$targetDir = Join-Path $targetRoot "FlowGuardian"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Flow Guardian.lnk"
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$startMenuShortcut = Join-Path $startMenuDir "Flow Guardian.lnk"
$exePath = Join-Path $targetDir "FlowGuardian.exe"

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
if (Test-Path $targetDir) {
    Remove-Item -LiteralPath $targetDir -Recurse -Force
}
Expand-Archive -LiteralPath $zipPath -DestinationPath $targetRoot -Force

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @($desktopShortcut, $startMenuShortcut)) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = $targetDir
    $shortcut.IconLocation = "$exePath,0"
    $shortcut.Save()
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
    "Flow Guardian has been installed.`n`nDesktop and Start Menu shortcuts are ready.",
    "Flow Guardian Installed",
    "OK",
    "Information"
) | Out-Null
