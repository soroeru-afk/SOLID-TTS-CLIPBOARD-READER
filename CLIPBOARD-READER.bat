@echo off
title SOLID TTS CLIPBOARD READER 起動
cd /d "%~dp0"

if exist "C:\Users\soroe\node-v22.13.1-win-x64" (
    set "PATH=C:\Users\soroe\node-v22.13.1-win-x64;%PATH%"
)

echo アプリケーションを起動しています...

:: バックグラウンドでローカル通信エンジン(server.ts)をサイレント起動
wscript.exe run_dev.vbs

:: サーバー起動待機（2秒）
timeout /t 2 /nobreak > nul

:: Chrome スタンドアローン PWA ウィンドウで起動（ポート 3005）
start chrome --app="http://localhost:3005/?mode=native" --user-data-dir="%temp%\solid-tts-profile" --window-size=380,480 --force-dark-mode --enable-features=WebUIDarkMode --no-first-run --no-default-browser-check

exit
