@echo off
REM 에듀톡 서버 Windows 서비스 해제 (관리자 권한 필요)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 관리자 권한으로 실행해 주세요. (우클릭 -^> 관리자 권한으로 실행)
  pause
  exit /b 1
)
cd /d "%~dp0"
node uninstall-service.js
pause
