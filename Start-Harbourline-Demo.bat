@echo off
setlocal DisableDelayedExpansion
title Harbourline Fictional Demo
if not exist "%~dp0Start-Platform.bat" (
    echo [ERROR] Start-Platform.bat is missing. Keep this launcher in the complete platform checkout.
    if not defined PLATFORM_NO_PAUSE pause
    exit /b 1
)
call "%~dp0Start-Platform.bat" -Demo -OneClickDemo -Harbourline %*
exit /b %errorlevel%