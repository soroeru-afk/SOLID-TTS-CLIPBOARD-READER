@echo off
title SOLID TTS CLIPBOARD READER ビルド
chcp 65001 > nul
cd /d "%~dp0"

if exist "C:\Users\soroe\node-v22.13.1-win-x64" (
    set "PATH=C:\Users\soroe\node-v22.13.1-win-x64;%PATH%"
)

echo ===================================================
echo   SOLID TTS CLIPBOARD READER - 本番用ビルド実行
echo ===================================================
echo.
echo アプリケーションをビルドしています...
echo.

cmd /c npm run build

pause
