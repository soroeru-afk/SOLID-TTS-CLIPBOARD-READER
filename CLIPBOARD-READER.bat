@echo off
title SOLID TTS CLIPBOARD READER 起動
chcp 65001 > nul
cd /d "%~dp0"

if exist "C:\Users\soroe\node-v22.13.1-win-x64" (
    set "PATH=C:\Users\soroe\node-v22.13.1-win-x64;%PATH%"
)

echo アプリケーションを起動しています...

:: Start Vite dev server silently using VBScript
wscript.exe run_dev.vbs

:: Wait 2 seconds for server startup
timeout /t 2 /nobreak > nul

:: Open Chrome in standalone App window with isolated profile, compact size and dark title bar
start chrome --app="http://localhost:3005" --user-data-dir="%temp%\solid-tts-profile" --window-size=380,420 --force-dark-mode --enable-features=WebUIDarkMode --no-first-run --no-default-browser-check

exit
