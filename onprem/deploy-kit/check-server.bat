@echo off
chcp 65001 >nul
setlocal
title 브리즈 서버 상태 확인
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-server.ps1"
