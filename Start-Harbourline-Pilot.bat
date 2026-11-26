@echo off
call "%~dp0Start-Platform.bat" -Pilot %*
exit /b %errorlevel%
