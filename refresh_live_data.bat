@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHON=D:\V-Right\.venv\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo [错误] 未找到 D:\V-Right\.venv\Scripts\python.exe
  pause
  exit /b 1
)
"%PYTHON%" scripts\build_live_data.py --model-root D:\V-Right --output-dir public\data
if errorlevel 1 (
  echo [错误] 数据生成失败。
  pause
  exit /b 1
)
echo [完成] live 数据已刷新。
pause
