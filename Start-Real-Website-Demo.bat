@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0scripts\windows\Real-Website-Demo.ps1" %*
set "demo_exit=%errorlevel%"
if not "%demo_exit%"=="0" (
    echo [ERROR] The real website demo could not complete. See the message above.
    if not defined PLATFORM_NO_PAUSE pause
)
exit /b %demo_exit%
