@echo off
title SOLID TTS CLIPBOARD READER 開発起動
chcp 65001 > nul
cd /d "%~dp0"

if exist "C:\Users\soroe\node-v22.13.1-win-x64" (
    set "PATH=C:\Users\soroe\node-v22.13.1-win-x64;%PATH%"
)

echo ===================================================
echo   SOLID TTS CLIPBOARD READER - 開発サーバー起動
echo ===================================================
echo.
echo ローカル開発環境を起動しています...
echo.

cmd /c npm run dev

pause
