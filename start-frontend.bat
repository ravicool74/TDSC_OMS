@echo off
echo Starting Expo Frontend on http://localhost:8081 ...
cd /d "%~dp0frontend"
call npx expo start --web
pause
