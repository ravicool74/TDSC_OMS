@echo off
echo Starting TDSC Frontend on http://localhost:8081 ...
cd /d "%~dp0frontend"
call npx.cmd serve -s dist -l 8081
pause
