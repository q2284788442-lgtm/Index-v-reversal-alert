@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "LOG=%ROOT%startup.log"
cd /d "%ROOT%"
if errorlevel 1 goto :path_failed
title Minute Model Live

echo [%date% %time%] Root: %ROOT%> "%LOG%"
echo ========================================
echo   Minute Model Live
echo ========================================
echo Root: %ROOT%
echo.

where node >nul 2>&1
if errorlevel 1 goto :node_missing
where npm.cmd >nul 2>&1
if errorlevel 1 goto :npm_missing

for /f "delims=" %%i in ('node -v') do echo [OK] Node.js %%i
for /f "delims=" %%i in ('npm.cmd -v') do echo [OK] npm %%i

if not exist "node_modules" goto :install_dependencies
goto :check_data

:install_dependencies
echo [INFO] Installing page dependencies for the first launch...
echo [INFO] npm install started.>> "%LOG%"
call npm.cmd install 2>> "%LOG%"
if errorlevel 1 goto :npm_install_failed

:check_data
if not exist "public\data\manifest.json" goto :data_missing
echo [OK] Model prediction data found.
echo [OK] URL: http://127.0.0.1:4174
echo Keep this window open. Press Ctrl+C to stop.
echo [%date% %time%] Starting Vite.>> "%LOG%"
start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:4174"
call npm.cmd run dev -- --host 127.0.0.1 --port 4174
if errorlevel 1 goto :server_failed
echo.
echo The page server has stopped.
pause
endlocal
exit /b 0

:path_failed
echo [ERROR] Cannot enter the project directory: %ROOT%
goto :failed

:node_missing
echo [ERROR] Node.js was not found.
echo Install Node.js LTS and reopen the terminal.
echo [ERROR] Node.js not found.>> "%LOG%"
goto :failed

:npm_missing
echo [ERROR] npm.cmd was not found.
echo Reinstall Node.js LTS and reopen the terminal.
echo [ERROR] npm.cmd not found.>> "%LOG%"
goto :failed

:npm_install_failed
echo [ERROR] npm install failed.
echo See startup.log for details.
goto :failed

:data_missing
echo [ERROR] Missing public\data\manifest.json.
echo Run refresh_live_data.bat first.
echo [ERROR] Live manifest missing.>> "%LOG%"
goto :failed

:server_failed
echo [ERROR] The page server failed to start.
echo Check startup.log and the command output above.
echo [ERROR] Vite failed.>> "%LOG%"
goto :failed

:failed
echo.
echo Startup failed.
echo Log file: %LOG%
echo Send the screen output or startup.log for diagnosis.
echo.
pause
endlocal
exit /b 1
