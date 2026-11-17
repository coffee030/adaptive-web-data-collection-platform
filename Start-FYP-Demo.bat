@echo off
setlocal DisableDelayedExpansion
title FYP Demo
if not exist "%~dp0Start-Platform.bat" (
    echo [ERROR] Start-Platform.bat is missing. Keep Start-FYP-Demo.bat in the complete platform checkout.
    if not defined PLATFORM_NO_PAUSE pause
    exit /b 1
)
call "%~dp0Start-Platform.bat" -Demo -OneClickDemo
exit /b %errorlevel%
