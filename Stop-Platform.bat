@echo off
rem Pass -Demo to select the isolated Synthetic Demo environment.
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0scripts\windows\Platform.ps1" -Action Stop %*
set "launcher_exit=%errorlevel%"
if not "%launcher_exit%"=="0" (
    echo [ERROR] The launcher could not complete. See the message above or run Diagnose-Platform.bat.
    if not defined PLATFORM_NO_PAUSE pause
)
exit /b %launcher_exit%
