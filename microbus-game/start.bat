@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo لازم تنزل Node.js الاول من https://nodejs.org & pause & exit /b)
if not exist node_modules call npm install
call npm run dev
pause
