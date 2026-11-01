@echo off
chcp 65001 >nul
setlocal
title 브리즈 서버 제거
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   관리자 권한이 필요해요.
  echo   이 파일을 우클릭한 뒤 [관리자 권한으로 실행]을 눌러 주세요.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-server.ps1"
