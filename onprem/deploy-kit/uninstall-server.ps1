# 브리즈 서버 자동 시작 해제 + 실행 중지 (관리자 권한 필요)
# 실행은 uninstall-server.bat 으로 해 주세요.
$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'BreezeServer'

Write-Host ''
Write-Host '  브리즈 서버를 멈추고 자동 시작을 해제할게요.' -ForegroundColor Cyan
Write-Host ''

schtasks /end /tn $TaskName *> $null
schtasks /delete /tn $TaskName /f *> $null
Get-Process 'breeze-server' | Stop-Process -Force
Get-NetFirewallRule -DisplayName 'Breeze Server*' | Remove-NetFirewallRule

Write-Host '  ✓ 자동 시작 해제 · 서버 중지 · 방화벽 규칙 삭제 완료' -ForegroundColor Green
Write-Host ''
Write-Host '  data 폴더(쪽지·계정·백업)는 지우지 않았어요.' -ForegroundColor Yellow
Write-Host '  완전히 삭제하려면 이 폴더를 직접 지워 주세요.' -ForegroundColor Yellow
Write-Host ''
Read-Host '  Enter 키를 누르면 닫혀요'
