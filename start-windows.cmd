@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js 20+ tai https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Dang cai thu vien... & call npm install)
if not exist .env if exist .env.example copy .env.example .env >nul
start "" http://127.0.0.1:3200
echo Post AI Studio: http://127.0.0.1:3200  (dong cua so nay = tat web)
node server.js
pause
