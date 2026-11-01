# 브리즈 서버 다시 시작 (관리자 권한 필요)
# 실행은 restart-server.bat 으로 해 주세요.
$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'BreezeServer'
$Port = 3000

Write-Host ''
Write-Host '  브리즈 서버를 다시 시작할게요.' -ForegroundColor Cyan

Get-Process 'breeze-server' | Stop-Process -Force
Start-Sleep -Milliseconds 800

$exists = schtasks /query /tn $TaskName *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host '  ! 자동 시작이 등록되어 있지 않아요. install-server.bat 을 먼저 실행해 주세요.' -ForegroundColor Yellow
  Read-Host '  Enter 키를 누르면 닫혀요'
  exit 1
}

Start-ScheduledTask -TaskName $TaskName
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host '  ✓ 서버가 다시 켜졌어요' -ForegroundColor Green
    Write-Host ''
    Read-Host '  Enter 키를 누르면 닫혀요'
    exit 0
  }
}
Write-Host '  ! 서버가 포트를 열지 못했어요. check-server.bat 으로 상태를 확인해 주세요.' -ForegroundColor Yellow
Write-Host ''
Read-Host '  Enter 키를 누르면 닫혀요'
