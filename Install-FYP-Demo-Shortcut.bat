@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0scripts\windows\Install-DemoShortcut.ps1"
set "shortcut_exit=%errorlevel%"
if not defined PLATFORM_NO_PAUSE pause
exit /b %shortcut_exit%
