@echo off
call "%~dp0Stop-Platform.bat" -Pilot %*
exit /b %errorlevel%
