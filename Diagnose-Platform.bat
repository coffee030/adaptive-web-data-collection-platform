@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0scripts\windows\Platform.ps1" -Action Diagnose %*
set "launcher_exit=%errorlevel%"
if not "%launcher_exit%"=="0" (
    echo [ERROR] Follow the recovery steps above for this workspace.
    if not defined PLATFORM_NO_PAUSE pause
)
exit /b %launcher_exit%
