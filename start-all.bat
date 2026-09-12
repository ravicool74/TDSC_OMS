@echo off
echo Starting TDSC FMS System (Backend + Frontend)...
start "FMS Backend" cmd /c "%~dp0start-backend.bat"
timeout /t 2 /nobreak >nul
start "FMS Frontend" cmd /c "%~dp0start-frontend.bat"
echo Services launched in separate windows.
