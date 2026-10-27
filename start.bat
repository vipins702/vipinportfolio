@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org then run this file again. & pause & exit /b)
if not exist node_modules\express (echo Installing, please wait... & call npm install)
start "" http://localhost:3000
call npm start
pause
