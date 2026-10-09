@echo off
REM 에듀톡 서버 Windows 서비스 등록 (관리자 권한 필요)
REM 우클릭 -> 관리자 권한으로 실행
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 관리자 권한으로 실행해 주세요. (우클릭 -^> 관리자 권한으로 실행)
  pause
  exit /b 1
)
cd /d "%~dp0"
if exist "%~dp0edutalk-server.exe" (
  node install-service.js "%~dp0edutalk-server.exe"
  if %errorlevel% neq 0 (
    echo Node가 없으면 NSSM 방식으로 직접 등록하세요.
  )
) else (
  call npm install
  node install-service.js
)
pause
